import { useEffect, useMemo, useRef, useState } from "react";
import { createEfiManifest, serializeEfiManifest } from "./build/createEfiManifest";
import { compatibilityRules } from "./data/rules";
import { communityProfiles } from "./data/communityProfiles";
import { hardwareFixtures } from "./data/hardwareFixtures";
import { sampleHardware } from "./data/sampleHardware";
import type {
  CompatibilityFinding,
  CompatibilityStatus,
  CommunityDiscoveryCatalog,
  DeviceCategory,
  MacOSVersion,
  HardwareReport,
  HardwareReportSource,
} from "./domain/types";
import { createBuildPlan } from "./engine/createBuildPlan";
import { evaluateCompatibility } from "./engine/evaluateCompatibility";
import { resolveCommunityProfiles } from "./community/resolveCommunityProfiles";
import { resolveDiscoveryCatalog } from "./community/resolveDiscoveryCatalog";
import {
  createComponentSelections,
  createDefaultComponentActions,
} from "./components/componentSelections";
import {
  nativeRuntimeAvailable,
  scanNativeHardware,
} from "./native/hardwareScanner";
import {
  buildEfiScaffold,
  copyEfiToEmptyTarget,
  mergeComponentSelections,
  mergeEfiSources,
  selectComponentSource,
  selectUsbMap,
  validateCustomEfi,
  type EfiValidationResult,
  type EfiMergeResult,
  type ComponentAction,
  type ComponentMergeResult,
  type ComponentScanResult,
  type InstallCopyResult,
  type ScaffoldResult,
  type UsbMapSelection,
} from "./native/efiBuilder";
import {
  hardwareReportFileName,
  parseHardwareReport,
  serializeHardwareReport,
} from "./report/hardwareReport";
import { downloadJson } from "./utils/downloadJson";
import { assessThinkPad } from "./thinkpad/assessThinkPad";
import {
  createVerificationEvidence,
  mayPromoteVerification,
  observationsForStage,
  parseVerificationEvidence,
  serializeVerificationEvidence,
  verifyEvidenceBinding,
  type CompletedVerificationStage,
  type VerificationObservation,
  type VerificationObservations,
} from "./feedback/verificationEvidence";

const statusCopy: Record<CompatibilityStatus, string> = {
  supported: "已支持",
  partial: "需校准",
  blocked: "高风险",
  unknown: "未覆盖",
};

const categoryCopy: Record<DeviceCategory, string> = {
  firmware: "固件",
  cpu: "处理器",
  board: "主板",
  gpu: "图形",
  network: "网络",
  audio: "音频",
  storage: "存储",
};

const macOSNames: Record<MacOSVersion, string> = {
  "13": "Ventura 13",
  "14": "Sonoma 14",
  "15": "Sequoia 15",
};

const sourceCopy: Record<HardwareReportSource, string> = {
  demo: "匿名演示报告",
  native: "本机只读扫描",
  imported: "导入的脱敏报告",
  fixture: "固定测试样本",
};

const componentKindCopy = {
  kext: "Kext",
  acpi: "ACPI",
  driver: "Driver",
} as const;

const componentComparisonCopy = {
  new: "项目中没有",
  identical: "内容完全相同",
  "path-conflict": "同名但内容不同",
  "identity-conflict": "同一组件的不同版本",
} as const;

const componentActionCopy: Record<ComponentAction, string> = {
  "keep-base": "保留项目版本",
  "use-imported": "改用用户版本",
  "add-inactive": "补入但不启用",
  "add-enabled": "加入并写入配置（实验）",
  "preserve-inactive": "隔离保留两份",
  skip: "不加入",
};

const thinkPadTierCopy = {
  "guided-candidate": "有同系列候选",
  "legacy-patch-required": "需要旧硬件补丁",
  "research-only": "研究路径",
  "unsupported-generation": "不进入自动推荐",
} as const;

const verificationStageCopy: Record<CompletedVerificationStage, string> = {
  "boot-tested": "OpenCore Picker 已启动",
  "recovery-tested": "Recovery 已启动",
  "install-verified": "安装流程已完成",
  "post-install-verified": "已进入安装后的桌面",
};

const optionalVerificationChecks: { key: keyof VerificationObservations; label: string }[] = [
  { key: "graphics", label: "图形输出" },
  { key: "network", label: "网络" },
  { key: "audio", label: "音频" },
  { key: "usb", label: "USB" },
  { key: "sleep", label: "睡眠/唤醒" },
];

function deviceIdentityCopy(device: HardwareReport["gpus"][number] | undefined): string {
  if (!device) return "----:----";
  const pciId = device.vendorId && device.deviceId
    ? `${device.vendorId}:${device.deviceId}`
    : "PCI ID 未取得";
  const source = device.identitySource === "direct-pci"
    ? "直接 PCI"
    : device.identitySource === "parent-pci"
      ? "父 PCI 控制器"
      : device.identitySource === "name-only"
        ? "仅名称"
        : "旧报告";
  return `${pciId} · ${source}`;
}

function StatusMark({ status }: { status: CompatibilityStatus }) {
  return (
    <span className={`status-mark status-${status}`} aria-label={statusCopy[status]}>
      <span className="status-dot" aria-hidden="true" />
      {statusCopy[status]}
    </span>
  );
}

function FindingRow({ finding }: { finding: CompatibilityFinding }) {
  return (
    <article className="finding-row">
      <div className="finding-heading">
        <span className="category-label">{categoryCopy[finding.category]}</span>
        <strong>{finding.subject}</strong>
        <StatusMark status={finding.status} />
      </div>
      <p>{finding.message}</p>
      <div className="finding-meta">
        <code>{finding.ruleId}</code>
        <span>{finding.action}</span>
      </div>
    </article>
  );
}

const guideSteps = [
  {
    icon: "scan" as const,
    title: "扫描或导入报告",
    text: "点击“扫描这台电脑”；如果本机扫描失败，也可以导入另一台电脑导出的脱敏 JSON 报告。",
  },
  {
    icon: "review" as const,
    title: "阅读兼容警告",
    text: "核对 CPU、主板、显卡、网卡和存储。信息不足只降低可信度，不会阻止你继续实验。",
  },
  {
    icon: "build" as const,
    title: "生成候选 EFI",
    text: "进入 EFI 组装，选择保存位置。工具下载哈希锁定组件，在新目录生成并运行结构检查。",
  },
  {
    icon: "usb" as const,
    title: "用独立 U 盘测试",
    text: "只复制到你选择的空目录，先测试 OpenCore 和 Recovery；不要直接替换电脑现有 EFI。",
  },
];

function GuideIcon({ kind }: { kind: (typeof guideSteps)[number]["icon"] }) {
  const common = {
    viewBox: "0 0 32 32",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (kind === "scan") {
    return <svg {...common}><rect x="4" y="5" width="18" height="14" rx="1" /><path d="M8 23h10M13 19v4M24 21l4 4M21 18a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /></svg>;
  }
  if (kind === "review") {
    return <svg {...common}><path d="M16 3 27 7v8c0 7-4.7 11.2-11 14-6.3-2.8-11-7-11-14V7l11-4Z" /><path d="m10.5 15.5 3.5 3.5 7.5-8" /></svg>;
  }
  if (kind === "build") {
    return <svg {...common}><path d="m16 4 11 6-11 6L5 10l11-6Z" /><path d="m5 16 11 6 11-6M5 22l11 6 11-6" /></svg>;
  }
  return <svg {...common}><path d="M12 4h8v7h3v17H9V11h3V4Z" /><path d="M14 4v5M18 4v5M13 15h6M13 20h6" /></svg>;
}

function App() {
  const [workflowStep, setWorkflowStep] = useState<2 | 3 | 4>(2);
  const [targetMacOS, setTargetMacOS] = useState<MacOSVersion>("14");
  const [amdSetupVirtualMap, setAmdSetupVirtualMap] = useState<boolean | undefined>(undefined);
  const [unsupportedGpuMode, setUnsupportedGpuMode] = useState<"disable" | "preserve">("disable");
  const [guideOpen, setGuideOpen] = useState(true);
  const [scanState, setScanState] = useState<"ready" | "scanning" | "complete">("complete");
  const [hardware, setHardware] = useState<HardwareReport>(sampleHardware);
  const [scanSource, setScanSource] = useState<HardwareReportSource>("demo");
  const [scanError, setScanError] = useState<string | null>(null);
  const [reportNotice, setReportNotice] = useState<string | null>(null);
  const [assemblyError, setAssemblyError] = useState<string | null>(null);
  const [assemblyBusy, setAssemblyBusy] = useState<
    "scaffold" | "validate" | "merge" | "component-scan" | "component-merge" | null
  >(null);
  const [scaffoldResult, setScaffoldResult] = useState<ScaffoldResult | null>(null);
  const [efiValidation, setEfiValidation] = useState<EfiValidationResult | null>(null);
  const [customEfiValidation, setCustomEfiValidation] = useState<EfiValidationResult | null>(null);
  const [activeEfiSource, setActiveEfiSource] = useState<
    "generated" | "custom" | "merged" | "component-merged" | null
  >(null);
  const [mergePreference, setMergePreference] = useState<"generated" | "custom">("generated");
  const [mergeResult, setMergeResult] = useState<EfiMergeResult | null>(null);
  const [componentScan, setComponentScan] = useState<ComponentScanResult | null>(null);
  const [componentActions, setComponentActions] = useState<Record<string, ComponentAction>>({});
  const [componentMergeResult, setComponentMergeResult] = useState<ComponentMergeResult | null>(null);
  const [usbMap, setUsbMap] = useState<UsbMapSelection | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [installResult, setInstallResult] = useState<InstallCopyResult | null>(null);
  const [discoveryCatalog, setDiscoveryCatalog] = useState<CommunityDiscoveryCatalog | null>(null);
  const [verificationStage, setVerificationStage] = useState<CompletedVerificationStage>("boot-tested");
  const [verificationResult, setVerificationResult] = useState<"passed" | "failed">("passed");
  const [verificationNotes, setVerificationNotes] = useState("");
  const [verificationChecks, setVerificationChecks] = useState<Partial<VerificationObservations>>({});
  const [verificationReview, setVerificationReview] = useState<string | null>(null);
  const reportInputRef = useRef<HTMLInputElement>(null);
  const verificationInputRef = useRef<HTMLInputElement>(null);
  const hasNativeRuntime = nativeRuntimeAvailable();

  useEffect(() => {
    let mounted = true;
    void import("./data/dalianskyCatalog").then(({ dalianskyCatalog }) => {
      if (mounted) setDiscoveryCatalog(dalianskyCatalog);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const report = useMemo(
    () => evaluateCompatibility(hardware, targetMacOS, compatibilityRules),
    [hardware, targetMacOS],
  );
  const buildPlan = useMemo(
    () => createBuildPlan(hardware, report, {
      amdSetupVirtualMap,
      customUsbMapIncluded: usbMap !== null,
      unsupportedGpuMode,
    }),
    [hardware, report, amdSetupVirtualMap, usbMap, unsupportedGpuMode],
  );
  const buildManifest = useMemo(
    () => createEfiManifest(hardware, targetMacOS, report, buildPlan),
    [hardware, targetMacOS, report, buildPlan],
  );
  const exactCommunityProfile = useMemo(
    () =>
      resolveCommunityProfiles(hardware, targetMacOS, communityProfiles).find(
        (match) => match.status === "exact",
      ),
    [hardware, targetMacOS],
  );
  const thinkPadAssessment = useMemo(
    () => assessThinkPad(hardware, targetMacOS),
    [hardware, targetMacOS],
  );
  const communityDiscoveries = useMemo(
    () => discoveryCatalog ? resolveDiscoveryCatalog(hardware, discoveryCatalog) : [],
    [hardware, discoveryCatalog],
  );

  const primaryGpu = hardware.gpus[0];
  const primaryNetwork = hardware.network[0];
  const primaryStorage = hardware.storage[0];
  const hasCompatibilityWarnings = report.status !== "supported";
  const hasFatalManifestFailure =
    buildManifest?.checks.some((check) => check.status === "failed") ?? false;
  const openCoreVersion = buildManifest?.components.find((item) => item.id === "opencore")?.version;
  const verificationBinding = buildManifest && openCoreVersion && efiValidation?.configSha256
    ? {
        hardwareKey: buildManifest.hardwareKey,
        biosVersion: hardware.board.biosVersion,
        targetMacOS,
        openCoreVersion,
        configSha256: efiValidation.configSha256,
      }
    : null;
  const verificationEligible = Boolean(
    verificationBinding
      && (scanSource === "native" || scanSource === "imported")
      && (activeEfiSource === "generated" || activeEfiSource === "component-merged"),
  );

  function resetBuildOutputs() {
    setAssemblyError(null);
    setScaffoldResult(null);
    setEfiValidation(null);
    setCustomEfiValidation(null);
    setActiveEfiSource(null);
    setMergeResult(null);
    setComponentScan(null);
    setComponentActions({});
    setComponentMergeResult(null);
    setInstallResult(null);
    setVerificationReview(null);
  }

  async function runScan() {
    setScanState("scanning");
    setScanError(null);
    setReportNotice(null);
    resetBuildOutputs();

    try {
      if (hasNativeRuntime) {
        const nativeHardware = await scanNativeHardware();
        setHardware(nativeHardware);
        setScanSource("native");
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, 850));
        setHardware(sampleHardware);
        setScanSource("demo");
      }
      setUsbMap(null);
      setAmdSetupVirtualMap(undefined);
      setUnsupportedGpuMode("disable");
      setScanState("complete");
      setWorkflowStep(2);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : String(error));
      setScanState("ready");
    }
  }

  function exportReport() {
    downloadJson(hardwareReportFileName(hardware), serializeHardwareReport(hardware));
    setReportNotice("已导出脱敏硬件报告；文件不包含用户名、序列号或网络凭据。");
  }

  async function importReport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

      setScanError(null);
      setReportNotice(null);
      resetBuildOutputs();
    try {
      if (file.size > 1024 * 1024) throw new Error("硬件报告不能超过 1 MB。");
      const imported = parseHardwareReport(JSON.parse(await file.text()));
      setHardware(imported);
      setUsbMap(null);
      setAmdSetupVirtualMap(undefined);
      setUnsupportedGpuMode("disable");
      setScanSource("imported");
      setScanState("complete");
      setWorkflowStep(2);
      setReportNotice(`已导入 ${imported.board.vendor} ${imported.board.model} 的脱敏报告。`);
    } catch (error) {
      setScanError(`报告导入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function loadFixture(fixtureId: string) {
    const fixture = hardwareFixtures.find((candidate) => candidate.id === fixtureId);
    if (!fixture) return;
    setHardware(parseHardwareReport(fixture.report));
    setUsbMap(null);
    setAmdSetupVirtualMap(undefined);
    setUnsupportedGpuMode("disable");
    setScanSource("fixture");
    setScanError(null);
    resetBuildOutputs();
    setWorkflowStep(2);
    setReportNotice(`已载入测试样本：${fixture.label}。${fixture.purpose}`);
  }

  function exportManifest() {
    if (!buildManifest) return;
    if (hasFatalManifestFailure) {
      setScanError("构建清单存在结构或组件校验失败，不能导出。硬件兼容性警告不会触发这个停止条件。");
      return;
    }
    const fileName = `efi-forge-manifest-${buildManifest.profile}-macos-${targetMacOS}.json`;
    downloadJson(fileName, serializeEfiManifest(buildManifest));
    setReportNotice(
      hasCompatibilityWarnings
        ? "已导出实验构建清单；硬件警告已保留，尚未通过 ocvalidate 和实机启动验证。"
        : "已导出候选构建清单；它已锁定组件哈希，但尚未通过 ocvalidate 和实机启动验证。",
    );
  }

  function continueToAssembly() {
    if (!buildManifest || hasFatalManifestFailure) {
      setScanError("构建结构或组件校验尚未通过，暂时不能进入 EFI 组装工作区。");
      return;
    }
    setScanError(null);
    setReportNotice(null);
    setWorkflowStep(3);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function createOfficialScaffold() {
    if (!buildManifest || !hasNativeRuntime) {
      setAssemblyError("真实组件构建仅能在 Windows 桌面版中执行。");
      return;
    }
    setAssemblyBusy("scaffold");
    setAssemblyError(null);
    setMergeResult(null);
    setComponentScan(null);
    setComponentActions({});
    setComponentMergeResult(null);
    try {
      const result = await buildEfiScaffold(buildManifest, usbMap?.sourcePath);
      if (result) {
        setScaffoldResult(result);
        if (result.readyForInstall) {
          setEfiValidation({
            rootPath: result.outputPath,
            valid: true,
            errors: [],
            warnings: result.warnings,
            validationLevel: result.validationLevel === "ocvalidate-passed" ? "ocvalidate-passed" : "structure-only",
            configSha256: result.configSha256,
          });
          setActiveEfiSource("generated");
          setReportNotice(`候选 EFI 已一键生成并通过同版本 ocvalidate：${result.outputPath}`);
        } else {
          setEfiValidation(null);
          setActiveEfiSource(null);
          setReportNotice(`官方组件暂存包已生成：${result.outputPath}`);
        }
      }
    } catch (error) {
      setAssemblyError(`暂存包生成失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAssemblyBusy(null);
    }
  }

  async function chooseUsbMap() {
    if (!hasNativeRuntime) {
      setAssemblyError("USB Map 导入仅能在 Windows 桌面版中执行。");
      return;
    }
    setAssemblyError(null);
    try {
      const result = await selectUsbMap();
      if (result) {
        setUsbMap(result);
        resetBuildOutputs();
        setReportNotice(`已选择 ${result.bundleName}；构建时会安全复制，不会修改源文件。`);
      }
    } catch (error) {
      setAssemblyError(`USB Map 拒绝导入：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function checkCustomEfi() {
    if (!hasNativeRuntime) {
      setAssemblyError("EFI 文件夹校验仅能在 Windows 桌面版中执行。");
      return;
    }
    setAssemblyBusy("validate");
    setAssemblyError(null);
    try {
      const result = await validateCustomEfi();
      if (result) {
        setCustomEfiValidation(result);
        setEfiValidation(result);
        setActiveEfiSource("custom");
        setMergeResult(null);
        setInstallResult(null);
        setReportNotice(
          result.valid
            ? `EFI 仅结构检查通过（未执行 ocvalidate）：${result.rootPath}`
            : `EFI 结构校验未通过，共发现 ${result.errors.length} 个必须修复的问题。`,
        );
      }
    } catch (error) {
      setAssemblyError(`EFI 校验失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAssemblyBusy(null);
    }
  }

  async function mergeGeneratedAndCustomEfi() {
    if (!scaffoldResult?.readyForInstall || !customEfiValidation?.valid || !hasNativeRuntime) {
      setAssemblyError("请先生成完整候选 EFI，并选择一份结构检查通过的用户 EFI。");
      return;
    }
    setAssemblyBusy("merge");
    setAssemblyError(null);
    try {
      const result = await mergeEfiSources(
        scaffoldResult.outputPath,
        customEfiValidation.rootPath,
        mergePreference,
      );
      if (result) {
        setMergeResult(result);
        setEfiValidation({
          rootPath: result.outputPath,
          valid: true,
          errors: [],
          warnings: result.warnings,
          validationLevel: result.validationLevel,
          configSha256: result.configSha256,
        });
        setActiveEfiSource("merged");
        setInstallResult(null);
        setReportNotice(`融合 EFI 副本已生成并通过结构检查：${result.outputPath}`);
      }
    } catch (error) {
      setAssemblyError(`EFI 融合已停止：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAssemblyBusy(null);
    }
  }

  function restoreGeneratedCandidate() {
    if (!scaffoldResult?.readyForInstall) {
      setEfiValidation(null);
      setActiveEfiSource(null);
      return;
    }
    setEfiValidation({
      rootPath: scaffoldResult.outputPath,
      valid: true,
      errors: [],
      warnings: scaffoldResult.warnings,
      validationLevel: scaffoldResult.validationLevel === "ocvalidate-passed" ? "ocvalidate-passed" : "structure-only",
      configSha256: scaffoldResult.configSha256,
    });
    setActiveEfiSource("generated");
  }

  async function scanUserComponents(selectionMode: "folder" | "files") {
    if (!scaffoldResult?.readyForInstall || !hasNativeRuntime) {
      setAssemblyError("请先生成通过 ocvalidate 的项目候选 EFI，再导入单独组件进行比较。");
      return;
    }
    setAssemblyBusy("component-scan");
    setAssemblyError(null);
    try {
      const result = await selectComponentSource(selectionMode, scaffoldResult.outputPath);
      if (result) {
        setComponentScan(result);
        setComponentActions(createDefaultComponentActions(result.items));
        setComponentMergeResult(null);
        if (activeEfiSource === "component-merged") restoreGeneratedCandidate();
        setReportNotice(`已只读扫描 ${result.items.length} 个用户组件；请逐项选择处理方式。`);
      }
    } catch (error) {
      setAssemblyError(`组件导入已停止：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAssemblyBusy(null);
    }
  }

  function chooseComponentAction(itemId: string, action: ComponentAction) {
    setComponentActions((current) => ({ ...current, [itemId]: action }));
    setComponentMergeResult(null);
    if (activeEfiSource === "component-merged") restoreGeneratedCandidate();
  }

  async function buildComponentMerge() {
    if (!componentScan || !scaffoldResult?.readyForInstall || !hasNativeRuntime) {
      setAssemblyError("组件扫描会话或项目候选 EFI 尚未就绪。");
      return;
    }
    const selections = createComponentSelections(componentScan.items, componentActions);
    setAssemblyBusy("component-merge");
    setAssemblyError(null);
    try {
      const result = await mergeComponentSelections(
        componentScan.scanId,
        scaffoldResult.outputPath,
        selections,
      );
      if (result) {
        setComponentMergeResult(result);
        setMergeResult(null);
        setEfiValidation({
          rootPath: result.outputPath,
          valid: true,
          errors: [],
          warnings: result.warnings,
          validationLevel: result.validationLevel,
          configSha256: result.configAfterSha256,
        });
        setActiveEfiSource("component-merged");
        setInstallResult(null);
        setReportNotice(`组件融合副本已生成：${result.outputPath}`);
      }
    } catch (error) {
      setAssemblyError(`组件融合已停止：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAssemblyBusy(null);
    }
  }

  function continueToInstallMedia() {
    if (!efiValidation?.valid) {
      setAssemblyError("只有结构完整的 EFI 才能进入安装介质步骤。兼容性警告不会阻止这里，但结构损坏会停止。");
      return;
    }
    setAssemblyError(null);
    setWorkflowStep(4);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function exportVerificationEvidence() {
    if (!verificationEligible || !verificationBinding || !buildManifest) {
      setAssemblyError("验证回传只接受本机扫描或脱敏导入报告，以及项目生成/受控组件 EFI 的真实 config.plist 哈希。");
      return;
    }
    try {
      const evidence = createVerificationEvidence(
        verificationBinding,
        verificationStage,
        verificationResult,
        observationsForStage(verificationStage, verificationResult, verificationChecks),
        verificationNotes.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      );
      downloadJson(
        `efi-forge-verification-${buildManifest.profile}-${evidence.configSha256.slice(0, 12)}.json`,
        serializeVerificationEvidence(evidence),
      );
      setVerificationReview("验证证据已导出；它不包含 SMBIOS 序列号，回导后仍会逐项核对硬件、BIOS、macOS、OpenCore 与 config 哈希。");
    } catch (error) {
      setAssemblyError(`验证证据无法导出：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function importVerificationEvidence(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !verificationBinding) return;
    setAssemblyError(null);
    try {
      if (file.size > 64 * 1024) throw new Error("验证证据不能超过 64 KB。");
      const evidence = parseVerificationEvidence(JSON.parse(await file.text()));
      const mismatches = verifyEvidenceBinding(evidence, verificationBinding);
      if (mismatches.length > 0) {
        setVerificationReview(`证据未绑定当前 EFI：${mismatches.join("、")}。不会提升验证阶段。`);
      } else if (mayPromoteVerification(evidence, verificationBinding)) {
        setVerificationReview(`证据与当前 EFI 精确绑定：${verificationStageCopy[evidence.stage]}。这是一条用户实测记录，不等于项目官方推荐。`);
      } else {
        setVerificationReview(`证据与当前 EFI 精确绑定，但记录结果为失败：${verificationStageCopy[evidence.stage]}。`);
      }
    } catch (error) {
      setAssemblyError(`验证证据导入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function copyValidatedEfi() {
    if (!efiValidation?.valid || !hasNativeRuntime) return;
    setInstallBusy(true);
    setAssemblyError(null);
    try {
      const result = await copyEfiToEmptyTarget(efiValidation.rootPath);
      if (result) setInstallResult(result);
    } catch (error) {
      setAssemblyError(`复制已停止：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setInstallBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            EF
          </span>
          <div>
            <p className="eyebrow">FIRMWARE WORKBENCH / ALPHA 01</p>
            <h1>EFI Forge</h1>
          </div>
        </div>

        <div className="target-control">
          <label htmlFor="macos-target">目标系统</label>
          <select
            id="macos-target"
            value={targetMacOS}
            onChange={(event) => {
              setTargetMacOS(event.target.value as MacOSVersion);
              setWorkflowStep(2);
              resetBuildOutputs();
            }}
          >
            {Object.entries(macOSNames).map(([version, name]) => (
              <option key={version} value={version}>
                macOS {name}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="workspace">
        <aside className="process-rail" aria-label="构建流程">
          <p className="rail-title">构建路径</p>
          <ol>
            <li className="complete">
              <span>01</span>
              <div>
                <strong>硬件扫描</strong>
                <small>7 类设备</small>
              </div>
            </li>
            <li className={workflowStep === 2 ? "active" : "complete"}>
              <span>02</span>
              <div>
                <strong>兼容判断</strong>
                <small>{report.coverage}% 规则覆盖</small>
              </div>
            </li>
            <li className={workflowStep === 3 ? "active" : workflowStep === 4 ? "complete" : ""}>
              <span>03</span>
              <div>
                <strong>EFI 组装</strong>
                <small>
                  {buildManifest
                    ? hasCompatibilityWarnings
                      ? "实验构建可执行"
                      : "候选构建可执行"
                    : "等待有效报告"}
                </small>
              </div>
            </li>
            <li className={workflowStep === 4 ? "active" : ""}>
              <span>04</span>
              <div>
                <strong>安装介质</strong>
                <small>
                  {efiValidation?.valid
                    ? efiValidation.validationLevel === "ocvalidate-passed"
                      ? "ocvalidate 已通过"
                      : "仅结构检查通过"
                    : "等待完整 EFI"}
                </small>
              </div>
            </li>
          </ol>

          <div className="safety-note">
            <span className="safety-icon" aria-hidden="true">◆</span>
            <p>
              官方组件只从锁定地址下载。工具不会格式化磁盘，也不会覆盖非空目录。
            </p>
          </div>
        </aside>

        {workflowStep === 2 ? (
          <>
        <main className="main-canvas">
          <section className="canvas-heading">
            <div>
              <p className="eyebrow">TARGET MACHINE / LOCAL REPORT</p>
              <h2>这台电脑的硬件指纹</h2>
              <p className="subcopy">
                结论来自精确设备信息与审核规则，不复用第三方整包 EFI。
              </p>
            </div>
            <div className="heading-actions">
              <button
                className={`scan-button ${scanState === "scanning" ? "is-scanning" : ""}`}
                type="button"
                onClick={runScan}
                disabled={scanState === "scanning"}
              >
                <span aria-hidden="true" />
                {scanState === "scanning"
                  ? "正在读取硬件…"
                  : hasNativeRuntime
                    ? "扫描这台电脑"
                    : "重新载入演示扫描"}
              </button>
            </div>
          </section>

          <section className="operation-guide" aria-labelledby="operation-guide-title">
            <header className="operation-guide-heading">
              <div>
                <p className="eyebrow">FIRST RUN / SAFE PATH</p>
                <h3 id="operation-guide-title">第一次使用，按这四步操作</h3>
                <p>每一步都在新目录中进行；遇到硬件警告仍可继续，涉及结构损坏或数据风险才会停止。</p>
              </div>
              <button
                type="button"
                aria-expanded={guideOpen}
                aria-controls="operation-guide-content"
                onClick={() => setGuideOpen((open) => !open)}
              >
                {guideOpen ? "收起指南" : "展开指南"}
                <span aria-hidden="true">{guideOpen ? "−" : "+"}</span>
              </button>
            </header>
            {guideOpen && (
              <div id="operation-guide-content" className="operation-guide-content">
                <ol className="guide-steps">
                  {guideSteps.map((step, index) => (
                    <li key={step.title} aria-current={index === 0 ? "step" : undefined}>
                      <div className="guide-step-visual">
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <GuideIcon kind={step.icon} />
                      </div>
                      <strong>{step.title}</strong>
                      <p>{step.text}</p>
                    </li>
                  ))}
                </ol>
                <aside className="guide-boundary" aria-label="当前版本能力边界">
                  <strong>当前版本的边界</strong>
                  <span>生成和检查 EFI</span>
                  <span>不格式化磁盘</span>
                  <span>不制作完整 macOS 安装盘</span>
                  <span>不保证未经真机验证的硬件一定启动</span>
                </aside>
              </div>
            )}
          </section>

          <section className="report-toolbar" aria-label="硬件报告工具">
            <div className="report-origin">
              <span>REPORT SOURCE</span>
              <strong>{sourceCopy[scanSource]}</strong>
            </div>
            <label className="fixture-control">
              <span>测试样本</span>
              <select defaultValue="" onChange={(event) => loadFixture(event.target.value)}>
                <option value="" disabled>选择固定样本…</option>
                {hardwareFixtures.map((fixture) => (
                  <option key={fixture.id} value={fixture.id}>{fixture.label}</option>
                ))}
              </select>
            </label>
            <div className="report-actions">
              <button type="button" onClick={() => reportInputRef.current?.click()}>导入报告</button>
              <button type="button" onClick={exportReport}>导出报告</button>
              <input
                ref={reportInputRef}
                className="visually-hidden"
                type="file"
                accept=".json,application/json"
                onChange={importReport}
              />
            </div>
          </section>

          {scanError && (
            <div className="scan-error" role="alert">
              <strong>扫描没有完成</strong>
              <span>{scanError}</span>
            </div>
          )}
          {reportNotice && <div className="report-notice" role="status">{reportNotice}</div>}
          {hasCompatibilityWarnings && (
            <div className="experimental-warning" role="status">
              <strong>实验模式仍可继续</strong>
              <span>检测到可能不兼容或信息不足的硬件。工具会保留警告并降低可信度，但不会替你锁死生成权限。</span>
            </div>
          )}

          <section className={`board-map ${scanState === "scanning" ? "is-scanning" : ""}`}>
            <div className="board-core">
              <span>CPU / PLATFORM</span>
              <strong>{hardware.cpu.name || "未识别处理器"}</strong>
              <code>
                FAMILY {hardware.cpu.family} · MODEL {hardware.cpu.model} · {hardware.cpu.cores}C/{hardware.cpu.threads}T
              </code>
            </div>

            <div className="device-node node-board">
              <span>MAINBOARD</span>
              <strong>{hardware.board.model || "未识别主板"}</strong>
              <small>{hardware.board.vendor || hardware.system.manufacturer}</small>
            </div>
            <div className="device-node node-gpu">
              <span>GRAPHICS</span>
              <strong>{primaryGpu?.name ?? "未检测到图形设备"}</strong>
              <code>{deviceIdentityCopy(primaryGpu)}</code>
            </div>
            <div className="device-node node-network">
              <span>NETWORK</span>
              <strong>{primaryNetwork?.name ?? "未检测到物理网卡"}</strong>
              <code>{deviceIdentityCopy(primaryNetwork)}</code>
            </div>
            <div className="device-node node-storage">
              <span>STORAGE</span>
              <strong>{primaryStorage?.name ?? "未检测到存储设备"}</strong>
              <code>{deviceIdentityCopy(primaryStorage)}</code>
            </div>
          </section>

          {thinkPadAssessment && (
            <section className="thinkpad-panel" aria-labelledby="thinkpad-title">
              <header>
                <div>
                  <p className="eyebrow">THINKPAD SPECIALIST ROUTE</p>
                  <h2 id="thinkpad-title">{thinkPadAssessment.title}</h2>
                  <p>{thinkPadAssessment.summary}</p>
                </div>
                <span className={`thinkpad-tier tier-${thinkPadAssessment.tier}`}>
                  {thinkPadTierCopy[thinkPadAssessment.tier]}
                </span>
              </header>

              <div className="thinkpad-identity">
                <div>
                  <span>四位机型码</span>
                  <strong>{hardware.system.machineType ?? "未取得"}</strong>
                </div>
                <div>
                  <span>匹配方式</span>
                  <strong>
                    {thinkPadAssessment.match === "machine-type"
                      ? "机型码精确命中"
                      : thinkPadAssessment.match === "product-name"
                        ? "产品名称命中"
                        : "ThinkPad 系列兜底"}
                  </strong>
                </div>
                <div>
                  <span>目标系统</span>
                  <strong>macOS {macOSNames[targetMacOS]}</strong>
                </div>
              </div>

              <div className="thinkpad-checks">
                {thinkPadAssessment.checks.map((check) => (
                  <article key={check.id} className={`thinkpad-check check-${check.status}`}>
                    <div>
                      <strong>{check.label}</strong>
                      <span>{check.status === "passed" ? "已核对" : check.status === "warning" ? "需确认" : "信息不足"}</span>
                    </div>
                    <p>{check.detail}</p>
                  </article>
                ))}
              </div>

              <footer>
                <div>
                  <strong>建议路径</strong>
                  <p>{thinkPadAssessment.route}</p>
                  <small>社区仓库仅作为候选证据，不会自动下载、信任或覆盖用户 EFI。</small>
                </div>
                {thinkPadAssessment.profile && (
                  <nav aria-label="ThinkPad 候选来源">
                    {thinkPadAssessment.profile.sources.map((source) => (
                      <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                        {source.label} ↗
                      </a>
                    ))}
                  </nav>
                )}
              </footer>
            </section>
          )}

          {discoveryCatalog && communityDiscoveries.length > 0 && (
            <section className="discovery-ledger" aria-labelledby="discovery-ledger-title">
              <header>
                <div>
                  <p className="eyebrow">COMMUNITY DISCOVERY LEDGER</p>
                  <h2 id="discovery-ledger-title">相似机型研究线索</h2>
                  <p>
                    根据当前整机型号查询 daliansky/Hackintosh 固定版本索引。这里展示的是第三方仓库入口，
                    不是已验证整包，也不会参与自动构建、下载或替换。
                  </p>
                </div>
                <span className="discovery-count">{communityDiscoveries.length} 条候选</span>
              </header>

              <div className="discovery-provenance">
                <div>
                  <span>来源</span>
                  <strong>daliansky/Hackintosh</strong>
                </div>
                <div>
                  <span>索引快照</span>
                  <strong>{discoveryCatalog.source.revision.slice(0, 10)}</strong>
                </div>
                <div>
                  <span>目录规模</span>
                  <strong>{discoveryCatalog.stats.entries} 个条目</strong>
                </div>
                <div>
                  <span>信任级别</span>
                  <strong>未审核线索</strong>
                </div>
                <a href={discoveryCatalog.source.repository} target="_blank" rel="noreferrer">
                  查看原始索引 ↗
                </a>
              </div>

              <div className="discovery-list">
                {communityDiscoveries.map((match) => (
                  <article key={match.entry.id}>
                    <div className="discovery-entry-heading">
                      <div>
                        <span>
                          {match.entry.section} · {match.entry.formFactor === "laptop" ? "笔记本" : "台式机"}
                        </span>
                        <strong>{match.entry.model}</strong>
                      </div>
                      <em className={`clue-${match.confidence}`}>
                        {match.confidence === "strong-clue" ? "强线索" : "可能相关"}
                      </em>
                    </div>
                    <p>{match.reasons.slice(0, 2).join("；")}</p>
                    <nav aria-label={`${match.entry.model} 第三方仓库`}>
                      {match.entry.repositories.slice(0, 3).map((repository, index) => (
                        <a key={repository} href={repository} target="_blank" rel="noreferrer">
                          候选仓库 {index + 1} ↗
                        </a>
                      ))}
                    </nav>
                  </article>
                ))}
              </div>

              <footer>
                <strong>使用边界</strong>
                <span>
                  仓库作者、许可证、OpenCore 版本、硬件变体和可启动性均需用户自行复核。索引命中不会提高构建可信度，
                  也不会解除 EFI 结构损坏与数据写入安全门。
                </span>
              </footer>
            </section>
          )}

          <section className="report-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">MODULE MATRIX</p>
                <h2>模块化适配矩阵</h2>
              </div>
              <span className="section-count">{report.modules.length} 个模块</span>
            </div>
            <div className="module-matrix">
              {report.modules.map((module) => (
                <article key={module.id} className={`module-cell status-${module.status}`}>
                  <div>
                    <strong>{module.label}</strong>
                    <span>{statusCopy[module.status]}</span>
                  </div>
                  <p>{module.summary}</p>
                  {module.choices.length > 0 && <small>{module.choices.length} 个用户可选分支</small>}
                </article>
              ))}
            </div>
          </section>

          <section className="report-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">RULE RESOLUTION</p>
                <h2>逐项判断</h2>
              </div>
              <span className="section-count">{report.findings.length} 个检查点</span>
            </div>
            <div className="finding-list">
              {report.findings.map((finding) => (
                <FindingRow key={finding.subjectId} finding={finding} />
              ))}
            </div>
          </section>
        </main>

        <aside className="result-rail">
          <section className="confidence-panel">
            <p className="eyebrow">BUILD CONFIDENCE</p>
            <div className="grade-line">
              <strong>{report.confidence}</strong>
              <div>
                <span>
                  {report.recommended ? "可生成候选方案" : "实验模式 · 允许继续"}
                </span>
                <small>目标：macOS {macOSNames[targetMacOS]}</small>
              </div>
            </div>
            <div className="coverage-meter" aria-label={`规则覆盖率 ${report.coverage}%`}>
              <span style={{ width: `${report.coverage}%` }} />
            </div>
            <div className="coverage-copy">
              <span>规则覆盖率</span>
              <strong>{report.coverage}%</strong>
            </div>
          </section>

          <section className="plan-panel">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">RESOLVED PLAN</p>
                <h2>候选构建</h2>
              </div>
            </div>

            {buildPlan ? (
              <>
                <dl className="plan-profile">
                  <div>
                    <dt>基础平台</dt>
                    <dd>{buildPlan.profile}</dd>
                  </div>
                  <div>
                    <dt>OpenCore</dt>
                    <dd>{buildManifest?.components.find((item) => item.id === "opencore")?.version ?? "等待方案"}</dd>
                  </div>
                  <div>
                    <dt>配置来源</dt>
                    <dd>
                      {exactCommunityProfile
                        ? `已验证整包：${exactCommunityProfile.profile.title}`
                        : hasCompatibilityWarnings
                          ? "用户选择 + 实验规则"
                          : "官方组件 + 动态规则"}
                    </dd>
                  </div>
                  <div>
                    <dt>启动路径</dt>
                    <dd>
                      {report.feasibility.level === "modern-uefi"
                        ? "现代 UEFI 候选"
                        : report.feasibility.level === "legacy-experimental"
                          ? "Legacy / OpenDuet 实验"
                          : report.feasibility.level === "instruction-set-risk"
                            ? "CPU 指令集风险"
                            : "旧平台手动 UEFI"}
                    </dd>
                  </div>
                </dl>

                <button
                  className="continue-button"
                  type="button"
                  onClick={continueToAssembly}
                  disabled={hasFatalManifestFailure}
                >
                  <span>{hasCompatibilityWarnings ? "以实验模式继续" : "继续下一步"}</span>
                  <strong>EFI 组装&nbsp; 03 →</strong>
                </button>

                <div className="plan-group">
                  <span>KEXTS</span>
                  <ul>{buildPlan.components.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
                <div className="plan-group">
                  <span>ACPI</span>
                  <ul>{buildPlan.acpi.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
                <div className="plan-group">
                  <span>DRIVERS</span>
                  <ul>{buildPlan.drivers.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>

                {buildManifest && (
                  <div className="validation-stack">
                    <span>VALIDATION GATES</span>
                    {buildManifest.checks.map((check) => (
                      <div key={check.id} className={`validation-check check-${check.status}`}>
                        <strong>{check.label}</strong>
                        <small>
                          {check.status === "passed"
                            ? "已通过"
                            : check.status === "warning"
                              ? "有警告"
                              : check.status === "failed"
                                ? "已停止"
                                : "待验证"}
                        </small>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  className="build-button"
                  type="button"
                  onClick={exportManifest}
                  disabled={hasFatalManifestFailure}
                >
                  {hasFatalManifestFailure
                    ? "结构或校验失败，不能导出"
                    : hasCompatibilityWarnings
                      ? "导出实验构建清单"
                      : "导出候选构建清单"}
                </button>
              </>
            ) : (
              <div className="blocked-plan">
                <strong>报告结构无效</strong>
                <p>只有无法解析硬件报告或构建结构时才会停止。硬件信息不足不会进入这里。</p>
              </div>
            )}
          </section>
        </aside>
          </>
        ) : workflowStep === 3 && buildPlan && buildManifest ? (
          <section className="assembly-workspace">
            <header className="assembly-header">
              <div>
                <p className="eyebrow">STEP 03 / EFI ASSEMBLY</p>
                <h2>EFI 组装工作区</h2>
                <p className="subcopy">
                  下载并校验官方组件，或验证你已有的完整 EFI。硬件警告不会剥夺继续权，结构损坏会停止。
                </p>
              </div>
              <span className={`assembly-mode ${hasCompatibilityWarnings ? "is-experimental" : ""}`}>
                {hasCompatibilityWarnings ? "实验模式" : "候选模式"}
              </span>
            </header>

            {hasCompatibilityWarnings && (
              <div className="experimental-warning assembly-warning" role="status">
                <strong>保留用户选择</strong>
                <span>当前硬件存在兼容性警告，清单仍可导出；它不会被标记为工具推荐或实机验证通过。</span>
              </div>
            )}
            {scanError && <div className="scan-error" role="alert"><strong>无法继续</strong><span>{scanError}</span></div>}
            {assemblyError && <div className="scan-error" role="alert"><strong>操作已停止</strong><span>{assemblyError}</span></div>}
            {reportNotice && <div className="report-notice" role="status">{reportNotice}</div>}

            <div className="assembly-grid">
              <section className="assembly-card component-card">
                <div className="assembly-card-heading">
                  <div>
                    <p className="eyebrow">LOCKED COMPONENTS</p>
                    <h3>官方组件锁</h3>
                  </div>
                  <strong>{buildManifest.components.length}</strong>
                </div>
                <div className="component-lock-list">
                  {buildManifest.components.map((component) => (
                    <article key={component.id}>
                      <div>
                        <strong>{component.name}</strong>
                        <small>{component.license}</small>
                      </div>
                      <code>v{component.version}</code>
                      <span title={component.sha256}>{component.sha256.slice(0, 12)}…</span>
                    </article>
                  ))}
                </div>
              </section>

              <section className="assembly-card tree-card">
                <div className="assembly-card-heading">
                  <div>
                    <p className="eyebrow">TARGET STRUCTURE</p>
                    <h3>计划目录</h3>
                  </div>
                </div>
                <div className="efi-tree" aria-label="EFI 计划目录结构">
                  <strong>EFI/OC</strong>
                  <div><span>Kexts</span><code>{buildPlan.components.length} 项</code></div>
                  <div><span>ACPI</span><code>{buildPlan.acpi.length} 项</code></div>
                  <div><span>Drivers</span><code>{buildPlan.drivers.length} 项</code></div>
                  <div>
                    <span>config.plist</span>
                    <code>{buildPlan.autoConfigSupported ? "自动生成 + ocvalidate" : "需用户提供"}</code>
                  </div>
                </div>
                <dl className="assembly-profile">
                  <div><dt>基础平台</dt><dd>{buildPlan.profile}</dd></div>
                  <div><dt>目标系统</dt><dd>macOS {macOSNames[targetMacOS]}</dd></div>
                  <div><dt>真机验证</dt><dd>{buildManifest.verificationStage === "candidate" ? "候选 / 尚未真机验证" : buildManifest.verificationStage}</dd></div>
                  {buildPlan.platform === "amd-zen" && (
                    <div>
                      <dt>内存映射</dt>
                      <dd>
                        <select
                          className="inline-option"
                          value={buildPlan.setupVirtualMap ? "enabled" : "disabled"}
                          onChange={(event) => {
                            setAmdSetupVirtualMap(event.target.value === "enabled");
                            resetBuildOutputs();
                          }}
                          aria-label="AMD SetupVirtualMap"
                        >
                          <option value="enabled">开启（可手动切换）</option>
                          <option value="disabled">关闭（可手动切换）</option>
                        </select>
                      </dd>
                    </div>
                  )}
                  {report.modules.find((module) => module.id === "graphics")?.choices.length ? (
                    <div>
                      <dt>混合显卡</dt>
                      <dd>
                        <select
                          className="inline-option"
                          value={unsupportedGpuMode}
                          onChange={(event) => {
                            setUnsupportedGpuMode(event.target.value as "disable" | "preserve");
                            resetBuildOutputs();
                          }}
                          aria-label="不兼容独显处理方式"
                        >
                          <option value="disable">禁用明确不兼容的独显（推荐）</option>
                          <option value="preserve">保留全部显卡（实验）</option>
                        </select>
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </section>

              <section className="assembly-card gates-card">
                <div className="assembly-card-heading">
                  <div>
                    <p className="eyebrow">VALIDATION GATES</p>
                    <h3>继续条件</h3>
                  </div>
                </div>
                <div className="assembly-gates">
                  {buildManifest.checks.map((check) => (
                    <article key={check.id} className={`check-${check.status}`}>
                      <span aria-hidden="true" />
                      <div><strong>{check.label}</strong><p>{check.detail}</p></div>
                      <small>
                        {check.status === "passed" ? "已通过" : check.status === "warning" ? "有警告" : check.status === "failed" ? "已停止" : "待完成"}
                      </small>
                    </article>
                  ))}
                </div>
              </section>

              <section className="assembly-card build-execution-card">
                <div className="assembly-card-heading">
                  <div>
                    <p className="eyebrow">BUILD OR BRING YOUR OWN</p>
                    <h3>选择 EFI 来源</h3>
                  </div>
                </div>
                <div className="build-paths">
                  <article>
                    <span className="path-index">A</span>
                    <div>
                      <strong>{buildPlan.autoConfigSupported ? "一键下载并生成候选 EFI" : "生成官方组件暂存包"}</strong>
                      <p>
                        {buildPlan.autoConfigSupported
                          ? "下载锁定组件并核对 SHA-256，自动写入平台 ACPI、Kext、SMBIOS 与 config.plist，再运行同版本 ocvalidate。"
                          : "联网下载锁定的 OpenCore 与 Kext，逐个核对大小和 SHA-256。自动配置尚未覆盖的平台只导出组件，不伪装成可启动 EFI。"}
                      </p>
                      <button className="secondary-button" type="button" onClick={createOfficialScaffold} disabled={assemblyBusy !== null || !hasNativeRuntime}>
                        {assemblyBusy === "scaffold"
                          ? "正在下载、配置并校验…"
                          : buildPlan.autoConfigSupported
                            ? "选择保存位置并一键生成"
                            : "选择保存位置并生成组件"}
                      </button>
                      <button className="secondary-button" type="button" onClick={chooseUsbMap} disabled={assemblyBusy !== null || !hasNativeRuntime}>
                        {usbMap ? `已选择 ${usbMap.bundleName}（重新选择）` : "可选：导入我的 UTBMap.kext"}
                      </button>
                      {usbMap && <p>安全检查已通过：codeless USBToolBox 映射；将配对锁定版 USBToolBox 1.2.0。</p>}
                    </div>
                  </article>
                  <article>
                    <span className="path-index">B</span>
                    <div>
                      <strong>使用我自己的完整 EFI</strong>
                      <p>允许使用专属、社区或手工 EFI。工具只读取并检查启动文件、config.plist、目录及已启用文件引用，不修改源文件。</p>
                      <button className="secondary-button" type="button" onClick={checkCustomEfi} disabled={assemblyBusy !== null || !hasNativeRuntime}>
                        {assemblyBusy === "validate" ? "正在检查结构…" : "选择 EFI 并校验"}
                      </button>
                    </div>
                  </article>
                  <article className="component-source-path">
                    <span className="path-index">C</span>
                    <div>
                      <strong>加入我的单独组件</strong>
                      <p>导入 Kext 文件夹、AML 或 UEFI Driver。默认只保留不启用；只有你逐项选择“加入并写入配置”时，工具才会在新副本写入最小条目并运行 ocvalidate。</p>
                      <div className="component-source-actions">
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => scanUserComponents("folder")}
                          disabled={assemblyBusy !== null || !scaffoldResult?.readyForInstall || !hasNativeRuntime}
                        >
                          {assemblyBusy === "component-scan" ? "正在安全扫描…" : "选择 Kext 或组件文件夹"}
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => scanUserComponents("files")}
                          disabled={assemblyBusy !== null || !scaffoldResult?.readyForInstall || !hasNativeRuntime}
                        >
                          选择 AML / EFI 文件
                        </button>
                      </div>
                      <div className="merge-readiness">
                        <span className={scaffoldResult?.readyForInstall ? "is-ready" : ""}>
                          A {scaffoldResult?.readyForInstall ? "项目候选已就绪" : "先生成项目候选"}
                        </span>
                        <span className={componentScan ? "is-ready" : ""}>
                          C {componentScan ? `${componentScan.items.length} 个组件已扫描` : "等待用户组件"}
                        </span>
                      </div>
                    </div>
                  </article>
                  <article className="merge-path">
                    <span className="path-index path-index-wide">A+B</span>
                    <div>
                      <strong>融合生成 EFI 与我的 EFI</strong>
                      <p>在全新的暂存目录中保留主来源，同名文件不覆盖；另一份 EFI 只补齐缺失文件。补入但未被主 config.plist 引用的组件只保留、不自动启用。</p>
                      <div className="merge-controls">
                        <label>
                          <span>同名冲突优先保留</span>
                          <select
                            className="inline-option"
                            value={mergePreference}
                            onChange={(event) => {
                              setMergePreference(event.target.value as "generated" | "custom");
                              setMergeResult(null);
                              if (activeEfiSource === "merged") {
                                if (customEfiValidation?.valid) {
                                  setEfiValidation(customEfiValidation);
                                  setActiveEfiSource("custom");
                                } else {
                                  setEfiValidation(null);
                                  setActiveEfiSource(null);
                                }
                              }
                            }}
                          >
                            <option value="generated">项目生成 EFI（推荐起点）</option>
                            <option value="custom">用户 EFI（保留专属配置）</option>
                          </select>
                        </label>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={mergeGeneratedAndCustomEfi}
                          disabled={assemblyBusy !== null || !scaffoldResult?.readyForInstall || !customEfiValidation?.valid || !hasNativeRuntime}
                        >
                          {assemblyBusy === "merge" ? "正在创建安全融合副本…" : "选择保存位置并融合"}
                        </button>
                      </div>
                      <div className="merge-readiness" aria-label="EFI 融合来源状态">
                        <span className={scaffoldResult?.readyForInstall ? "is-ready" : ""}>
                          A {scaffoldResult?.readyForInstall ? "完整候选已就绪" : "等待完整候选 EFI"}
                        </span>
                        <span className={customEfiValidation?.valid ? "is-ready" : ""}>
                          B {customEfiValidation?.valid ? "用户 EFI 结构已通过" : "等待用户 EFI 校验"}
                        </span>
                      </div>
                    </div>
                  </article>
                </div>

                {componentScan && (
                  <section className="component-switchboard" aria-label="用户组件选择工作台">
                    <div className="component-switchboard-heading">
                      <div>
                        <p className="eyebrow">COMPONENT SWITCHBOARD</p>
                        <h4>逐项决定组件去向</h4>
                      </div>
                      <div className="source-convergence" aria-label="来源汇合状态">
                        <span>A 项目候选</span><i aria-hidden="true">→</i><span>C {componentScan.sourceLabel}</span><i aria-hidden="true">→</i><strong>新副本</strong>
                      </div>
                    </div>
                    <div className="component-table" role="table" aria-label="组件差异和用户选择">
                      <div className="component-table-head" role="row">
                        <span>组件</span><span>项目状态</span><span>用户来源</span><span>处理方式</span>
                      </div>
                      {componentScan.items.map((item) => (
                        <article className={`component-row comparison-${item.comparison}`} key={item.id} role="row">
                          <div className="component-identity" role="cell">
                            <span className={`component-kind kind-${item.kind}`}>{componentKindCopy[item.kind]}</span>
                            <div>
                              <strong>{item.name}</strong>
                              <code>{item.identity}</code>
                              <small>{item.version ? `v${item.version} · ` : ""}{(item.size / 1024).toFixed(1)} KB</small>
                            </div>
                          </div>
                          <div className="component-comparison" role="cell">
                            <strong>{componentComparisonCopy[item.comparison]}</strong>
                            <code>{item.baseSha256 ? `${item.baseSha256.slice(0, 12)}…` : "项目中无对应文件"}</code>
                            <small>{item.baseEnabled ? "原配置已启用" : "原配置未启用"}</small>
                          </div>
                          <div className="component-user-source" role="cell">
                            <code>{item.sha256.slice(0, 12)}…</code>
                            <small>{item.sourcePath}</small>
                            {item.dependencies.length > 0 && <small>{item.dependencies.length} 个 Kext 依赖</small>}
                            {item.configPreview.map((preview) => <small key={preview}>{preview}</small>)}
                          </div>
                          <div className="component-choice" role="cell">
                            <select
                              value={componentActions[item.id] ?? item.defaultAction}
                              onChange={(event) => chooseComponentAction(item.id, event.target.value as ComponentAction)}
                              aria-label={`${item.name} 的处理方式`}
                            >
                              {item.allowedActions.map((action) => (
                                <option value={action} key={action}>{componentActionCopy[action]}</option>
                              ))}
                            </select>
                            <small>
                              {(componentActions[item.id] ?? item.defaultAction) === "add-enabled"
                                ? "将写入最小配置并运行 ocvalidate"
                                : (componentActions[item.id] ?? item.defaultAction) === "use-imported" && item.baseEnabled
                                ? "沿用原路径引用；不改配置"
                                : (componentActions[item.id] ?? item.defaultAction).includes("inactive")
                                  ? "只复制，不会加载"
                                  : "不改变项目配置"}
                            </small>
                          </div>
                          <div className="component-row-warning">
                            {item.warnings.map((warning) => <span key={warning}>{warning}</span>)}
                          </div>
                        </article>
                      ))}
                    </div>
                    <div className="component-switchboard-footer">
                      <div>
                        {componentScan.items.some(
                          (item) => (componentActions[item.id] ?? item.defaultAction) === "add-enabled",
                        ) && (
                          <strong className="component-enable-notice">
                            将启用 {componentScan.items.filter(
                              (item) => (componentActions[item.id] ?? item.defaultAction) === "add-enabled",
                            ).length} 个用户组件：生成最小配置、检查依赖并运行锁定版 ocvalidate
                          </strong>
                        )}
                        {componentScan.warnings.map((warning) => <span key={warning}>{warning}</span>)}
                      </div>
                      <button
                        className="build-button"
                        type="button"
                        onClick={buildComponentMerge}
                        disabled={assemblyBusy !== null || !scaffoldResult?.readyForInstall}
                      >
                        {assemblyBusy === "component-merge" ? "正在生成组件融合副本…" : "按当前选择生成新副本"}
                      </button>
                    </div>
                  </section>
                )}

                {scaffoldResult && (
                  <div className={`execution-result ${scaffoldResult.readyForInstall ? "is-passed" : "is-warning"}`} role="status">
                    <strong>{scaffoldResult.readyForInstall ? "候选 EFI：ocvalidate 已通过" : "官方组件暂存包已生成"}</strong>
                    <code>{scaffoldResult.outputPath}</code>
                    <span>
                      {scaffoldResult.readyForInstall
                        ? `${scaffoldResult.filesWritten} 个文件；仅代表 config.plist、引用完整性与同版本 ocvalidate 已通过，不代表真机可启动或可安装。`
                        : `${scaffoldResult.filesWritten} 个文件；仍缺少专属配置，不能直接用于启动。`}
                    </span>
                    {scaffoldResult.warnings.map((warning) => <span key={warning}>{warning}</span>)}
                  </div>
                )}
                {efiValidation && (
                  <div className={`execution-result ${efiValidation.valid ? "is-passed" : "is-failed"}`} role="status">
                    <strong>
                      {efiValidation.valid
                        ? activeEfiSource === "component-merged"
                          ? efiValidation.validationLevel === "ocvalidate-passed"
                            ? "受控组件 EFI：依赖、引用与 ocvalidate 已通过"
                            : "组件融合 EFI：结构与引用检查通过"
                          : efiValidation.validationLevel === "ocvalidate-passed"
                            ? "候选 EFI：ocvalidate 已通过"
                            : activeEfiSource === "merged"
                              ? "完整 EFI 融合：结构与引用检查通过"
                            : "自有 EFI：仅结构检查通过"
                        : "EFI 结构损坏，已停止"}
                    </strong>
                    <code>{efiValidation.rootPath}</code>
                    {efiValidation.configSha256 && (
                      <code title={efiValidation.configSha256}>config SHA-256 {efiValidation.configSha256}</code>
                    )}
                    {(efiValidation.valid ? efiValidation.warnings : efiValidation.errors).map((message) => <span key={message}>{message}</span>)}
                  </div>
                )}
                {mergeResult && (
                  <div className="execution-result merge-result is-passed" role="status">
                    <strong>安全融合副本已生成</strong>
                    <code>{mergeResult.outputPath}</code>
                    <span>
                      主来源 {mergeResult.preferredSource === "generated" ? "项目生成 EFI" : "用户 EFI"}；补入 {mergeResult.missingFilesAdded} 个缺失文件，保留主来源处理 {mergeResult.conflictsKept} 个同名冲突。
                    </span>
                    <span>{mergeResult.inactiveAddedFiles.length} 个补入组件仅保留、未自动启用。</span>
                    {mergeResult.inactiveAddedFiles.slice(0, 5).map((item) => <code key={item}>{item}</code>)}
                  </div>
                )}
                {componentMergeResult && (
                  <div className="execution-result merge-result is-passed" role="status">
                    <strong>组件融合副本已生成</strong>
                    <code>{componentMergeResult.outputPath}</code>
                    <span>
                      新增 {componentMergeResult.componentsAdded} 项，替换 {componentMergeResult.componentsReplaced} 项，隔离保留 {componentMergeResult.componentsPreserved} 项。
                    </span>
                    <span>
                      {componentMergeResult.configModified
                        ? `config.plist 已受控写入 ${componentMergeResult.configChanges.length} 项，并通过锁定版 ocvalidate。`
                        : "config.plist 保持原样；未选择启用的新增组件不会加载。"}
                    </span>
                    {componentMergeResult.configChanges.map((change) => <code key={change}>{change}</code>)}
                    {componentMergeResult.configModified && (
                      <code>
                        config {componentMergeResult.configBeforeSha256.slice(0, 12)}… → {componentMergeResult.configAfterSha256.slice(0, 12)}…
                      </code>
                    )}
                  </div>
                )}
              </section>
            </div>

            {efiValidation?.valid && (
              <section className="verification-ledger" aria-labelledby="verification-ledger-title">
                <div className="verification-ledger-heading">
                  <div>
                    <p className="eyebrow">REAL-MACHINE EVIDENCE</p>
                    <h3 id="verification-ledger-title">真机验证回传</h3>
                  </div>
                  <span>{verificationEligible ? "可绑定当前候选" : "仅项目候选可回传"}</span>
                </div>
                <p>
                  证据精确绑定硬件指纹、BIOS、macOS、OpenCore 与当前 config.plist 哈希；不会写入 EFI，也不会自动提升项目推荐。
                </p>
                {verificationEligible ? (
                  <>
                    <div className="verification-fields">
                      <label>
                        <span>达到阶段</span>
                        <select value={verificationStage} onChange={(event) => setVerificationStage(event.target.value as CompletedVerificationStage)}>
                          {Object.entries(verificationStageCopy).map(([stage, label]) => <option key={stage} value={stage}>{label}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>结果</span>
                        <select value={verificationResult} onChange={(event) => setVerificationResult(event.target.value as "passed" | "failed")}>
                          <option value="passed">通过</option>
                          <option value="failed">失败</option>
                        </select>
                      </label>
                      {optionalVerificationChecks.map((check) => (
                        <label key={check.key}>
                          <span>{check.label}</span>
                          <select
                            value={verificationChecks[check.key] ?? "not-tested"}
                            onChange={(event) => setVerificationChecks((current) => ({
                              ...current,
                              [check.key]: event.target.value as VerificationObservation,
                            }))}
                          >
                            <option value="not-tested">未测试</option>
                            <option value="passed">通过</option>
                            <option value="failed">失败</option>
                          </select>
                        </label>
                      ))}
                    </div>
                    <label className="verification-notes">
                      <span>备注（每行一项，最多 12 项）</span>
                      <textarea value={verificationNotes} onChange={(event) => setVerificationNotes(event.target.value)} rows={3} maxLength={3000} placeholder="例如：从独立 U 盘进入 Recovery；睡眠唤醒尚未测试" />
                    </label>
                    <div className="verification-actions">
                      <button className="secondary-button" type="button" onClick={() => verificationInputRef.current?.click()}>回导并核对证据</button>
                      <button className="build-button" type="button" onClick={exportVerificationEvidence}>导出验证证据</button>
                      <input ref={verificationInputRef} className="visually-hidden" type="file" accept=".json,application/json" onChange={importVerificationEvidence} />
                    </div>
                  </>
                ) : (
                  <small>请使用本机扫描或脱敏导入报告，并选择项目生成 EFI 或受控组件 EFI。自有/整包融合 EFI 的 OpenCore 来源无法被工具可靠确认。</small>
                )}
                {verificationReview && <div className="verification-review" role="status">{verificationReview}</div>}
              </section>
            )}

            <div className="assembly-actions">
              <button className="secondary-button" type="button" onClick={() => setWorkflowStep(2)}>
                ← 返回兼容判断
              </button>
              <div>
                <button className="secondary-button" type="button" onClick={exportManifest}>
                  导出构建清单
                </button>
                <button className="build-button" type="button" onClick={continueToInstallMedia} disabled={!efiValidation?.valid}>
                  {efiValidation?.valid ? "进入安装介质 04 →" : "验证完整 EFI 后继续"}
                </button>
              </div>
            </div>
          </section>
        ) : workflowStep === 4 && efiValidation?.valid ? (
          <section className="assembly-workspace install-workspace">
            <header className="assembly-header">
              <div>
                <p className="eyebrow">STEP 04 / INSTALL MEDIA</p>
                <h2>安装介质准备</h2>
                <p className="subcopy">将已验证的 EFI 复制到你选择的空目录。此版本不格式化磁盘、不创建分区、不覆盖已有文件。</p>
              </div>
              <span className="assembly-mode">只复制 / 不格式化</span>
            </header>

            {assemblyError && <div className="scan-error" role="alert"><strong>操作已停止</strong><span>{assemblyError}</span></div>}
            <div className="install-grid">
              <section className="assembly-card install-source-card">
                <p className="eyebrow">CHECKED SOURCE</p>
                <h3>
                  {activeEfiSource === "component-merged"
                    ? efiValidation.validationLevel === "ocvalidate-passed"
                      ? "依赖与 ocvalidate 已通过的受控组件 EFI"
                      : "结构检查通过的组件融合 EFI 副本"
                    : efiValidation.validationLevel === "ocvalidate-passed"
                      ? "ocvalidate 已通过的候选 EFI"
                      : activeEfiSource === "merged"
                        ? "结构检查通过的完整 EFI 融合副本"
                      : "仅结构检查通过的自有 EFI"}
                </h3>
                <code>{efiValidation.rootPath}</code>
                <ul>
                  <li>必需启动文件存在且非空</li>
                  <li>config.plist 可以解析并包含 OpenCore 顶层结构</li>
                  <li>启用的 ACPI、Kext 与 Driver 引用均能找到</li>
                </ul>
              </section>
              <section className="assembly-card install-safety-card">
                <p className="eyebrow">DATA SAFETY GATE</p>
                <h3>写入保护</h3>
                <ul>
                  <li>目标必须是空目录</li>
                  <li>源目录与目标目录不能互相包含</li>
                  <li>遇到符号链接、现有文件或复制错误立即停止</li>
                  <li>工具不会请求管理员权限或执行格式化</li>
                </ul>
              </section>
            </div>

            {installResult && (
              <div className="install-complete" role="status">
                <strong>EFI 已安全复制</strong>
                <code>{installResult.targetPath}</code>
                <span>共复制 {installResult.filesCopied} 个文件。下一步仍需在外部支持机上进行 Recovery 启动测试。</span>
              </div>
            )}

            <div className="assembly-actions">
              <button className="secondary-button" type="button" onClick={() => setWorkflowStep(3)}>← 返回 EFI 组装</button>
              <div>
                <span>只接受空目录；发现已有内容将自动停止</span>
                <button className="build-button" type="button" onClick={copyValidatedEfi} disabled={installBusy}>
                  {installBusy ? "正在安全复制…" : installResult ? "重新选择空目录" : "选择空目录并复制 EFI"}
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className="assembly-workspace">
            <div className="scan-error" role="alert">
              <strong>构建结构无效</strong>
              <span>请返回兼容判断并重新扫描或导入硬件报告。</span>
            </div>
            <button className="secondary-button" type="button" onClick={() => setWorkflowStep(2)}>返回兼容判断</button>
          </section>
        )}
      </div>

      <footer>
        <span>EFI Forge v0.1.9</span>
        <p>
          非 Apple 官方工具 · 当前数据来自{sourceCopy[scanSource]}
        </p>
      </footer>
    </div>
  );
}

export default App;
