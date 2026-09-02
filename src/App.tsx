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
  AcpiClockEvidence,
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
  selectAcpiClockEvidence,
  selectComponentSource,
  selectUsbMap,
  validateCustomEfi,
  type EfiValidationResult,
  type EfiMergeResult,
  type ComponentAction,
  type ComponentMergeResult,
  type ComponentScanResult,
  type SafeCopyResult,
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
import { canBuildFromHardwareSource } from "./workflow/hardwareSourcePolicy";
import { assessBuildReadiness } from "./workflow/buildReadiness";
import {
  canVisitWorkflowStep,
  summarizeCompatibility,
  workflowStepCopy,
  type WorkflowStep,
} from "./workflow/userJourney";
import { formatOperationFailure } from "./workflow/operationFailure";
import { createHandoffSummary, serializeHandoffSummary } from "./workflow/handoffSummary";
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
  "26": "Tahoe 26（手动研究）",
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

const buildRouteStatusCopy = {
  ready: "可生成候选",
  available: "可随时选择",
  manual: "需要手动配置",
  blocked: "完整性阻断",
} as const;

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

const appVersion = "0.1.12";

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
    title: "复制到独立测试介质",
    text: "普通空文件夹只能导出检查；要启动时，请选择已挂载的独立 U 盘 FAT32 EFI 分区根目录。工具不会分区或制作完整 macOS 安装盘。",
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
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>(1);
  const [targetMacOS, setTargetMacOS] = useState<MacOSVersion>("14");
  const [amdSetupVirtualMap, setAmdSetupVirtualMap] = useState<boolean | undefined>(undefined);
  const [intelClockMode, setIntelClockMode] = useState<"awac" | "manual" | undefined>(undefined);
  const [intelClockEvidence, setIntelClockEvidence] = useState<AcpiClockEvidence | null>(null);
  const [unsupportedGpuMode, setUnsupportedGpuMode] = useState<"disable" | "preserve">("disable");
  const [guideOpen, setGuideOpen] = useState(true);
  const [scanState, setScanState] = useState<"ready" | "scanning" | "complete">("complete");
  const [hardware, setHardware] = useState<HardwareReport>(sampleHardware);
  const [scanSource, setScanSource] = useState<HardwareReportSource>("demo");
  const [scanError, setScanError] = useState<string | null>(null);
  const [reportNotice, setReportNotice] = useState<string | null>(null);
  const [assemblyError, setAssemblyError] = useState<string | null>(null);
  const [assemblyBusy, setAssemblyBusy] = useState<
    "scaffold" | "validate" | "merge" | "component-scan" | "component-merge" | "acpi-analyze" | null
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
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyResult, setCopyResult] = useState<SafeCopyResult | null>(null);
  const [discoveryCatalog, setDiscoveryCatalog] = useState<CommunityDiscoveryCatalog | null>(null);
  const [verificationStage, setVerificationStage] = useState<CompletedVerificationStage>("boot-tested");
  const [verificationResult, setVerificationResult] = useState<"passed" | "failed">("passed");
  const [verificationNotes, setVerificationNotes] = useState("");
  const [verificationChecks, setVerificationChecks] = useState<Partial<VerificationObservations>>({});
  const [verificationReview, setVerificationReview] = useState<string | null>(null);
  const reportInputRef = useRef<HTMLInputElement>(null);
  const verificationInputRef = useRef<HTMLInputElement>(null);
  const workflowHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousWorkflowStepRef = useRef<WorkflowStep>(workflowStep);
  const workflowEpochRef = useRef(0);
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

  useEffect(() => {
    if (previousWorkflowStepRef.current === workflowStep) return;
    previousWorkflowStepRef.current = workflowStep;
    const frame = window.requestAnimationFrame(() => {
      workflowHeadingRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [workflowStep]);

  const report = useMemo(
    () => evaluateCompatibility(hardware, targetMacOS, compatibilityRules),
    [hardware, targetMacOS],
  );
  const buildPlan = useMemo(
    () => createBuildPlan(hardware, report, {
      amdSetupVirtualMap,
      intelClockMode,
      intelClockEvidence: intelClockEvidence ?? undefined,
      customUsbMapIncluded: usbMap !== null,
      unsupportedGpuMode,
    }),
    [
      hardware,
      report,
      amdSetupVirtualMap,
      intelClockMode,
      intelClockEvidence,
      usbMap,
      unsupportedGpuMode,
    ],
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
  const hardwareInputReady = canBuildFromHardwareSource(scanSource);
  const previewReport = !hardwareInputReady;
  const compatibilityDigest = useMemo(
    () => summarizeCompatibility(report.findings),
    [report.findings],
  );
  const buildReadiness = useMemo(
    () => assessBuildReadiness(hardware, report, buildPlan, {
      softwareIntegrityFailure: hasFatalManifestFailure,
    }),
    [hardware, report, buildPlan, hasFatalManifestFailure],
  );
  const workflowLocked = scanState === "scanning" || assemblyBusy !== null || copyBusy;

  function workflowStepAvailable(step: WorkflowStep): boolean {
    return canVisitWorkflowStep(step, {
      hardwareInputReady,
      fixturePreview: scanSource === "fixture",
      manifestReady: Boolean(buildManifest) && !hasFatalManifestFailure,
      efiReady: Boolean(efiValidation?.valid),
    });
  }

  function workflowStepDetail(step: WorkflowStep): string {
    if (step === 1) return hardwareInputReady ? "报告已就绪" : "现在开始";
    if (step === 2) {
      return hardwareInputReady ? `${compatibilityDigest.attention} 项需要关注` : "等待本机报告";
    }
    if (step === 3) {
      if (scaffoldResult?.readyForCopy) return "候选已校验";
      if (hasFatalManifestFailure) return "结构或完整性失败";
      if (!hardwareInputReady) return "等待报告";
      return buildReadiness.mode === "auto-candidate" ? "候选路径可用" : "手动路径可用";
    }
    return efiValidation?.valid ? "可进入受控复制" : "等待完整 EFI";
  }

  function navigateToWorkflowStep(step: WorkflowStep) {
    if (workflowLocked || !workflowStepAvailable(step)) return;
    setWorkflowStep(step);
    if (step === 1) setGuideOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetBuildOutputs() {
    workflowEpochRef.current += 1;
    setAssemblyError(null);
    setScaffoldResult(null);
    setEfiValidation(null);
    setCustomEfiValidation(null);
    setActiveEfiSource(null);
    setMergeResult(null);
    setComponentScan(null);
    setComponentActions({});
    setComponentMergeResult(null);
    setCopyResult(null);
    setVerificationReview(null);
  }

  async function runScan() {
    setScanState("scanning");
    setScanError(null);
    setReportNotice(null);
    resetBuildOutputs();
    const workflowEpoch = workflowEpochRef.current;

    try {
      if (hasNativeRuntime) {
        const nativeHardware = parseHardwareReport(await scanNativeHardware());
        if (workflowEpoch !== workflowEpochRef.current) return;
        setHardware(nativeHardware);
        setScanSource("native");
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, 850));
        if (workflowEpoch !== workflowEpochRef.current) return;
        setHardware(sampleHardware);
        setScanSource("demo");
      }
      setUsbMap(null);
      setAmdSetupVirtualMap(undefined);
      setIntelClockMode(undefined);
      setIntelClockEvidence(null);
      setUnsupportedGpuMode("disable");
      setScanState("complete");
      setWorkflowStep(hasNativeRuntime ? 2 : 1);
      if (hasNativeRuntime) setGuideOpen(false);
    } catch (error) {
      if (workflowEpoch !== workflowEpochRef.current) return;
      setScanError(error instanceof Error ? error.message : String(error));
      setScanState("ready");
      setWorkflowStep(1);
    }
  }

  function exportReport() {
    if (!hardwareInputReady) {
      setScanError("演示和固定测试样本不能导出为可重新导入的硬件报告。请先扫描目标电脑。");
      return;
    }
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
    const workflowEpoch = workflowEpochRef.current;
    try {
      if (file.size > 1024 * 1024) throw new Error("硬件报告不能超过 1 MB。");
      const imported = parseHardwareReport(JSON.parse(await file.text()));
      if (workflowEpoch !== workflowEpochRef.current) return;
      setHardware(imported);
      setUsbMap(null);
      setAmdSetupVirtualMap(undefined);
      setIntelClockMode(undefined);
      setIntelClockEvidence(null);
      setUnsupportedGpuMode("disable");
      setScanSource("imported");
      setScanState("complete");
      setWorkflowStep(2);
      setGuideOpen(false);
      setReportNotice(`已导入 ${imported.board.vendor} ${imported.board.model} 的脱敏报告。`);
    } catch (error) {
      if (workflowEpoch !== workflowEpochRef.current) return;
      setScanError(`报告导入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function loadFixture(fixtureId: string) {
    const fixture = hardwareFixtures.find((candidate) => candidate.id === fixtureId);
    if (!fixture) return;
    setHardware(parseHardwareReport(fixture.report));
    setUsbMap(null);
    setAmdSetupVirtualMap(undefined);
    setIntelClockMode(undefined);
    setIntelClockEvidence(null);
    setUnsupportedGpuMode("disable");
    setScanSource("fixture");
    setScanState("complete");
    setScanError(null);
    resetBuildOutputs();
    setWorkflowStep(2);
    setReportNotice(`已载入测试样本：${fixture.label}。${fixture.purpose}`);
  }

  function exportManifest() {
    if (!buildManifest) return;
    if (!hardwareInputReady) {
      setScanError("演示与固定测试报告只用于预览。请扫描这台电脑或导入它的脱敏报告后再导出构建清单。");
      return;
    }
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
    if (!hardwareInputReady) {
      setScanError("当前报告不是这台电脑的本机扫描或导入报告，不能据此生成 EFI。");
      return;
    }
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
    const workflowEpoch = workflowEpochRef.current;
    try {
      const result = await buildEfiScaffold(buildManifest, usbMap?.sourcePath);
      if (workflowEpoch !== workflowEpochRef.current) return;
      if (result) {
        setCopyResult(null);
        setVerificationReview(null);
        setScaffoldResult(result);
        if (result.readyForCopy) {
          setEfiValidation({
            rootPath: result.outputPath,
            valid: true,
            errors: [],
            warnings: result.warnings,
            validationLevel: result.validationLevel === "ocvalidate-passed" ? "ocvalidate-passed" : "structure-only",
            configSha256: result.configSha256,
          });
          setActiveEfiSource("generated");
          setReportNotice(`候选 EFI 已生成并通过同版本 ocvalidate：${result.outputPath}`);
        } else {
          setEfiValidation(null);
          setActiveEfiSource(null);
          setReportNotice(`官方组件暂存包已生成：${result.outputPath}`);
        }
      }
    } catch (error) {
      if (workflowEpoch !== workflowEpochRef.current) return;
      setAssemblyError(formatOperationFailure("暂存包生成失败", error));
    } finally {
      if (workflowEpoch === workflowEpochRef.current) setAssemblyBusy(null);
    }
  }

  async function chooseUsbMap() {
    if (!hasNativeRuntime) {
      setAssemblyError("USB Map 导入仅能在 Windows 桌面版中执行。");
      return;
    }
    setAssemblyError(null);
    const workflowEpoch = workflowEpochRef.current;
    try {
      const result = await selectUsbMap();
      if (workflowEpoch !== workflowEpochRef.current) return;
      if (result) {
        setUsbMap(result);
        resetBuildOutputs();
        setReportNotice(`已选择 ${result.bundleName}；构建时会安全复制，不会修改源文件。`);
      }
    } catch (error) {
      if (workflowEpoch !== workflowEpochRef.current) return;
      setAssemblyError(formatOperationFailure("USB Map 拒绝导入", error));
    }
  }

  async function analyzeAcpiClock() {
    if (!hasNativeRuntime) {
      setAssemblyError("DSDT 静态分析仅能在 Windows 桌面版中执行。");
      return;
    }
    setAssemblyBusy("acpi-analyze");
    setAssemblyError(null);
    const workflowEpoch = workflowEpochRef.current;
    try {
      const result = await selectAcpiClockEvidence();
      if (workflowEpoch !== workflowEpochRef.current) return;
      if (result) {
        setIntelClockEvidence(result);
        resetBuildOutputs();
        setReportNotice(
          `DSDT 结构与校验和通过，已记录 ${result.confidence === "strong-clue" ? "强线索" : result.confidence === "possible-clue" ? "可能线索" : "证据不足"}；建议尚未自动应用。`,
        );
      }
    } catch (error) {
      if (workflowEpoch !== workflowEpochRef.current) return;
      setAssemblyError(formatOperationFailure("DSDT 分析已停止", error));
    } finally {
      if (workflowEpoch === workflowEpochRef.current) setAssemblyBusy(null);
    }
  }

  function applyAcpiClockSuggestion() {
    if (!intelClockEvidence) return;
    setIntelClockMode(intelClockEvidence.suggestedMode);
    resetBuildOutputs();
    setReportNotice(
      `已由用户应用 DSDT 静态建议：${intelClockEvidence.suggestedMode === "awac" ? "预编译 AWAC 候选" : "手动 RTC0 / SSDTTime 路径"}。`,
    );
  }

  async function checkCustomEfi() {
    if (!hasNativeRuntime) {
      setAssemblyError("EFI 文件夹校验仅能在 Windows 桌面版中执行。");
      return;
    }
    setAssemblyBusy("validate");
    setAssemblyError(null);
    const workflowEpoch = workflowEpochRef.current;
    try {
      const result = await validateCustomEfi();
      if (workflowEpoch !== workflowEpochRef.current) return;
      if (result) {
        setCustomEfiValidation(result);
        setEfiValidation(result);
        setActiveEfiSource("custom");
        setMergeResult(null);
        setCopyResult(null);
        setReportNotice(
          result.valid
            ? `EFI 仅结构检查通过（未执行 ocvalidate）：${result.rootPath}`
            : `EFI 结构校验未通过，共发现 ${result.errors.length} 个必须修复的问题。`,
        );
      }
    } catch (error) {
      if (workflowEpoch !== workflowEpochRef.current) return;
      setAssemblyError(formatOperationFailure("EFI 校验失败", error));
    } finally {
      if (workflowEpoch === workflowEpochRef.current) setAssemblyBusy(null);
    }
  }

  async function mergeGeneratedAndCustomEfi() {
    if (!scaffoldResult?.readyForCopy || !customEfiValidation?.valid || !hasNativeRuntime) {
      setAssemblyError("请先生成完整候选 EFI，并选择一份结构检查通过的用户 EFI。");
      return;
    }
    setAssemblyBusy("merge");
    setAssemblyError(null);
    const workflowEpoch = workflowEpochRef.current;
    try {
      const result = await mergeEfiSources(
        scaffoldResult.outputPath,
        customEfiValidation.rootPath,
        mergePreference,
      );
      if (workflowEpoch !== workflowEpochRef.current) return;
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
        setCopyResult(null);
        setReportNotice(`融合 EFI 副本已生成并通过结构检查：${result.outputPath}`);
      }
    } catch (error) {
      if (workflowEpoch !== workflowEpochRef.current) return;
      setAssemblyError(formatOperationFailure("EFI 融合已停止", error));
    } finally {
      if (workflowEpoch === workflowEpochRef.current) setAssemblyBusy(null);
    }
  }

  function restoreGeneratedCandidate() {
    setCopyResult(null);
    setVerificationReview(null);
    if (!scaffoldResult?.readyForCopy) {
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
    if (!scaffoldResult?.readyForCopy || !hasNativeRuntime) {
      setAssemblyError("请先生成通过 ocvalidate 的项目候选 EFI，再导入单独组件进行比较。");
      return;
    }
    setAssemblyBusy("component-scan");
    setAssemblyError(null);
    const workflowEpoch = workflowEpochRef.current;
    try {
      const result = await selectComponentSource(selectionMode, scaffoldResult.outputPath);
      if (workflowEpoch !== workflowEpochRef.current) return;
      if (result) {
        setComponentScan(result);
        setComponentActions(createDefaultComponentActions(result.items));
        setComponentMergeResult(null);
        if (activeEfiSource === "component-merged") restoreGeneratedCandidate();
        setReportNotice(`已只读扫描 ${result.items.length} 个用户组件；请逐项选择处理方式。`);
      }
    } catch (error) {
      if (workflowEpoch !== workflowEpochRef.current) return;
      setAssemblyError(formatOperationFailure("组件导入已停止", error));
    } finally {
      if (workflowEpoch === workflowEpochRef.current) setAssemblyBusy(null);
    }
  }

  function chooseComponentAction(itemId: string, action: ComponentAction) {
    setComponentActions((current) => ({ ...current, [itemId]: action }));
    setComponentMergeResult(null);
    if (activeEfiSource === "component-merged") {
      restoreGeneratedCandidate();
      setReportNotice("组件选择已经变化；已恢复项目生成候选，请重新生成组件融合副本。");
    }
  }

  async function buildComponentMerge() {
    if (!componentScan || !scaffoldResult?.readyForCopy || !hasNativeRuntime) {
      setAssemblyError("组件扫描会话或项目候选 EFI 尚未就绪。");
      return;
    }
    const selections = createComponentSelections(componentScan.items, componentActions);
    setAssemblyBusy("component-merge");
    setAssemblyError(null);
    const workflowEpoch = workflowEpochRef.current;
    try {
      const result = await mergeComponentSelections(
        componentScan.scanId,
        scaffoldResult.outputPath,
        selections,
      );
      if (workflowEpoch !== workflowEpochRef.current) return;
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
        setCopyResult(null);
        setReportNotice(`组件融合副本已生成：${result.outputPath}`);
      }
    } catch (error) {
      if (workflowEpoch !== workflowEpochRef.current) return;
      setAssemblyError(formatOperationFailure("组件融合已停止", error));
    } finally {
      if (workflowEpoch === workflowEpochRef.current) setAssemblyBusy(null);
    }
  }

  function continueToCopyTest() {
    if (!efiValidation?.valid) {
      setAssemblyError("只有结构完整的 EFI 才能进入复制与测试步骤。兼容性警告不会阻止这里，但结构损坏会停止。");
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
      setAssemblyError(formatOperationFailure("验证证据无法导出", error));
    }
  }

  async function importVerificationEvidence(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !verificationBinding) return;
    setAssemblyError(null);
    const workflowEpoch = workflowEpochRef.current;
    try {
      if (file.size > 64 * 1024) throw new Error("验证证据不能超过 64 KB。");
      const evidence = parseVerificationEvidence(JSON.parse(await file.text()));
      if (workflowEpoch !== workflowEpochRef.current) return;
      const mismatches = verifyEvidenceBinding(evidence, verificationBinding);
      if (mismatches.length > 0) {
        setVerificationReview(`证据未绑定当前 EFI：${mismatches.join("、")}。不会提升验证阶段。`);
      } else if (mayPromoteVerification(evidence, verificationBinding)) {
        setVerificationReview(`证据与当前 EFI 精确绑定：${verificationStageCopy[evidence.stage]}。这是一条用户实测记录，不等于项目官方推荐。`);
      } else {
        setVerificationReview(`证据与当前 EFI 精确绑定，但记录结果为失败：${verificationStageCopy[evidence.stage]}。`);
      }
    } catch (error) {
      if (workflowEpoch !== workflowEpochRef.current) return;
      setAssemblyError(formatOperationFailure("验证证据导入失败", error));
    }
  }

  async function copyValidatedEfi() {
    if (!efiValidation?.valid || !hasNativeRuntime) return;
    setCopyBusy(true);
    setAssemblyError(null);
    const workflowEpoch = workflowEpochRef.current;
    try {
      const result = await copyEfiToEmptyTarget(efiValidation.rootPath);
      if (workflowEpoch !== workflowEpochRef.current) return;
      if (result) setCopyResult(result);
    } catch (error) {
      if (workflowEpoch !== workflowEpochRef.current) return;
      setAssemblyError(formatOperationFailure("复制已停止", error));
    } finally {
      if (workflowEpoch === workflowEpochRef.current) setCopyBusy(false);
    }
  }

  function exportHandoffSummary() {
    if (!buildPlan || !efiValidation?.valid || !activeEfiSource) {
      setAssemblyError("请先选择并校验一份完整 EFI，再导出转移与求助摘要。");
      return;
    }
    const summary = createHandoffSummary({
      appVersion,
      hardware,
      report,
      reportSource: scanSource,
      targetMacOS,
      plan: buildPlan,
      efiSource: activeEfiSource,
      validation: efiValidation,
    });
    downloadJson(
      `efi-forge-handoff-${buildPlan.profile}-macos-${targetMacOS}.json`,
      serializeHandoffSummary(summary),
    );
    setReportNotice("已导出转移与求助摘要；不包含本机文件路径、序列号或网络凭据。");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            EF
          </span>
          <div>
            <p className="eyebrow">FIRMWARE WORKBENCH / ALPHA 0.1.12</p>
            <h1>EFI Forge</h1>
          </div>
        </div>

        <div className="target-control">
          <label htmlFor="macos-target">目标系统</label>
          <select
            id="macos-target"
            value={targetMacOS}
            disabled={workflowLocked}
            onChange={(event) => {
              setTargetMacOS(event.target.value as MacOSVersion);
              setWorkflowStep(scanSource === "demo" ? 1 : 2);
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

      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        当前步骤：{workflowStepCopy[workflowStep - 1].title}。
        {scanState === "scanning"
          ? "正在读取硬件。"
          : assemblyBusy
            ? "正在处理 EFI 文件。"
            : copyBusy
              ? "正在安全复制 EFI。"
              : workflowStepDetail(workflowStep)}
      </div>

      <div className="workspace">
        <aside className="process-rail" aria-label="构建流程">
          <p className="rail-title">构建路径</p>
          <ol>
            {workflowStepCopy.map((step) => {
              const available = workflowStepAvailable(step.id);
              const complete = step.id < workflowStep;
              return (
                <li
                  key={step.id}
                  className={workflowStep === step.id ? "active" : complete ? "complete" : available ? "available" : ""}
                  aria-current={workflowStep === step.id ? "step" : undefined}
                >
                  <button
                    type="button"
                    onClick={() => navigateToWorkflowStep(step.id)}
                    disabled={!available || workflowLocked}
                    aria-label={`${step.title}：${workflowStepDetail(step.id)}`}
                  >
                    <span>{String(step.id).padStart(2, "0")}</span>
                    <div>
                      <strong>{step.title}</strong>
                      <small>{workflowStepDetail(step.id)}</small>
                    </div>
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="safety-note">
            <span className="safety-icon" aria-hidden="true">◆</span>
            <p>
              官方组件只从锁定地址下载。工具不会格式化磁盘，也不会覆盖非空目录。
            </p>
          </div>
        </aside>

        {workflowStep <= 2 ? (
          <>
        <main className="main-canvas">
          <section className="canvas-heading">
            <div>
              <p className="eyebrow">TARGET MACHINE / LOCAL REPORT</p>
              <h2 ref={workflowHeadingRef} tabIndex={-1}>这台电脑的硬件指纹</h2>
              <p className="subcopy">
                结论来自精确设备信息与审核规则，不复用第三方整包 EFI。
              </p>
            </div>
            <div className="heading-actions">
              {workflowStep === 2 ? (
                <button
                  className={`scan-button ${scanState === "scanning" ? "is-scanning" : ""}`}
                  type="button"
                  onClick={runScan}
                  disabled={scanState === "scanning"}
                >
                  <span aria-hidden="true" />
                  {scanState === "scanning" ? "正在重新扫描…" : hasNativeRuntime ? "重新扫描本机" : "返回演示报告"}
                </button>
              ) : (
                <span className="current-task-badge">当前任务：取得本机报告</span>
              )}
            </div>
          </section>

          {workflowStep === 1 && (
            <section className="hardware-entry-panel" aria-labelledby="hardware-entry-title">
              <div className="hardware-entry-heading">
                <p className="eyebrow">START HERE</p>
                <h3 id="hardware-entry-title">先告诉工具这台电脑有什么硬件</h3>
                <p>推荐直接扫描本机；也可以导入由 EFI Forge 在另一台电脑上导出的脱敏 JSON 报告。</p>
              </div>
              <div className="hardware-entry-actions">
                <button
                  className={`hardware-entry-primary ${scanState === "scanning" ? "is-scanning" : ""}`}
                  type="button"
                  onClick={runScan}
                  disabled={scanState === "scanning"}
                >
                  <span>推荐</span>
                  <strong>{scanState === "scanning" ? "正在读取硬件…" : hasNativeRuntime ? "扫描这台电脑" : "载入演示扫描"}</strong>
                  <small>只读取硬件信息，不修改 BIOS、磁盘或现有 EFI。</small>
                </button>
                <button
                  className="hardware-entry-secondary"
                  type="button"
                  onClick={() => reportInputRef.current?.click()}
                  disabled={scanState === "scanning"}
                >
                  <span>另一种方式</span>
                  <strong>导入脱敏硬件报告</strong>
                  <small>适合目标电脑无法直接运行本工具的情况。</small>
                </button>
              </div>
              <details className="fixture-library">
                <summary>只是想体验界面？打开固定测试样本</summary>
                <label>
                  <span>体验示例不能生成或导出 EFI</span>
                  <select defaultValue="" onChange={(event) => loadFixture(event.target.value)} disabled={scanState === "scanning"}>
                    <option value="" disabled>选择固定样本…</option>
                    {hardwareFixtures.map((fixture) => (
                      <option key={fixture.id} value={fixture.id}>{fixture.label}</option>
                    ))}
                  </select>
                </label>
              </details>
            </section>
          )}

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
                    <li key={step.title} aria-current={index === workflowStep - 1 ? "step" : undefined}>
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

          {workflowStep === 2 && (
            <section className="report-toolbar" aria-label="当前硬件报告">
              <div className="report-origin">
                <span>当前报告来源</span>
                <strong>{sourceCopy[scanSource]}</strong>
              </div>
              <p>目标：macOS {macOSNames[targetMacOS]} · 规则识别度 {report.coverage}%（不是成功率）</p>
              <div className="report-actions">
                <button type="button" onClick={() => reportInputRef.current?.click()} disabled={scanState === "scanning"}>换一份报告</button>
                <button type="button" onClick={exportReport} disabled={previewReport}>
                  {previewReport ? "测试样本不可导出" : "导出脱敏报告"}
                </button>
              </div>
            </section>
          )}
          <input
            ref={reportInputRef}
            className="visually-hidden"
            type="file"
            accept=".json,application/json"
            onChange={importReport}
          />

          {scanError && (
            <div className="scan-error" role="alert">
              <strong>当前操作未完成</strong>
              <span>{scanError}</span>
            </div>
          )}
          {reportNotice && <div className="report-notice" role="status">{reportNotice}</div>}
          {previewReport && (
            <div className="preview-warning" role="status">
              <strong>当前不是你的硬件报告</strong>
              <span>
                下方内容来自{sourceCopy[scanSource]}，只用于了解界面和规则。请扫描这台电脑或导入它的脱敏报告，之后才能生成或导出对应 EFI。
              </span>
            </div>
          )}
          {hasCompatibilityWarnings && hardwareInputReady && (
            <div className="experimental-warning" role="status">
              <strong>实验模式仍可继续</strong>
              <span>检测到可能不兼容或信息不足的硬件。工具会保留警告并降低可信度，但不会替你锁死生成权限。</span>
            </div>
          )}
          {targetMacOS === "26" && hardwareInputReady && (
            <div className="experimental-warning" role="status">
              <strong>Tahoe 26 当前只开放手动研究路径</strong>
              <span>不会自动生成 config.plist。模拟音频已失去 AppleHDA 默认路径，WhateverGreen、无线、SMBIOS 与系统更新设置也需要逐项复核。</span>
            </div>
          )}

          {hardwareInputReady && (
            <section className="compatibility-digest" aria-labelledby="compatibility-digest-title">
              <header>
                <div>
                  <p className="eyebrow">WHAT NEEDS YOUR ATTENTION</p>
                  <h3 id="compatibility-digest-title">
                    {compatibilityDigest.attention > 0
                      ? `先核对 ${compatibilityDigest.attention} 项，再决定如何生成`
                      : "当前检查项没有发现需要人工处理的风险"}
                  </h3>
                </div>
                <span>{report.coverage}% 规则识别度</span>
              </header>
              <div className="compatibility-digest-stats">
                <div><strong>{compatibilityDigest.supported}</strong><span>已有规则</span></div>
                <div><strong>{compatibilityDigest.attention}</strong><span>需要关注</span></div>
                <div><strong>{compatibilityDigest.highRisk}</strong><span>高风险线索</span></div>
                <div><strong>{compatibilityDigest.unknown}</strong><span>尚未覆盖</span></div>
              </div>
              {compatibilityDigest.topActions.length > 0 && (
                <ol className="compatibility-next-checks">
                  {compatibilityDigest.topActions.map((finding) => (
                    <li key={finding.subjectId}>
                      <StatusMark status={finding.status} />
                      <div><strong>{finding.subject}</strong><span>{finding.action}</span></div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          {hardwareInputReady && (
            <section className="build-readiness-panel" aria-labelledby="build-readiness-title">
              <header>
                <div>
                  <p className="eyebrow">BUILD ROUTES / USER CONTROL</p>
                  <h3 id="build-readiness-title">{buildReadiness.headline}</h3>
                  <p>{buildReadiness.notice}</p>
                </div>
                <span className={`readiness-mode mode-${buildReadiness.mode} ${buildReadiness.canContinue ? "" : "is-blocked"}`}>
                  {!buildReadiness.canContinue
                    ? "结构 / 完整性阻断"
                    : buildReadiness.mode === "auto-candidate"
                      ? "自动候选可用"
                      : "手动路径可用"}
                </span>
              </header>

              {buildReadiness.blockingReason && (
                <div className="readiness-blocker" role="alert">{buildReadiness.blockingReason}</div>
              )}

              <div className="build-route-grid">
                {buildReadiness.routes.map((route, index) => (
                  <article key={route.id} className={`build-route route-${route.status}`}>
                    <div className="build-route-heading">
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <em>{buildRouteStatusCopy[route.status]}</em>
                    </div>
                    <strong>{route.title}</strong>
                    <p>{route.summary}</p>
                    <small>{route.nextAction}</small>
                  </article>
                ))}
              </div>

              {buildReadiness.evidenceGaps.length > 0 ? (
                <details className="evidence-gap-list">
                  <summary>
                    <span>可补充的硬件证据</span>
                    <strong>{buildReadiness.evidenceGaps.length} 项 · 不阻止继续</strong>
                  </summary>
                  <div>
                    {buildReadiness.evidenceGaps.map((gap) => (
                      <article key={gap.id} className={`gap-${gap.priority}`}>
                        <span>{gap.priority === "important" ? "优先补充" : "有条件再补"}</span>
                        <strong>{gap.label}</strong>
                        <p>{gap.detail}</p>
                        <small>{gap.nextAction}</small>
                      </article>
                    ))}
                  </div>
                </details>
              ) : (
                <div className="evidence-complete-note">
                  已取得当前规则所需的主要硬件身份；后续仍以 EFI 校验和真机启动记录为准。
                </div>
              )}
            </section>
          )}

          <section className={`mobile-next-action ${previewReport ? "is-preview" : ""}`} aria-label="当前流程下一步">
            <div>
              <span>NEXT ACTION</span>
              <strong>
                {previewReport
                  ? "先取得这台电脑的报告"
                  : !buildReadiness.canContinue
                    ? "软件完整性检查未通过"
                    : "硬件报告已就绪"}
              </strong>
              <small>
                {previewReport
                  ? "扫描本机或导入脱敏报告后，才会开放对应 EFI 的生成入口。"
                  : !buildReadiness.canContinue
                    ? buildReadiness.blockingReason
                  : buildReadiness.mode === "auto-candidate"
                    ? "检查上方警告后，可生成项目候选或改用自己的 EFI。"
                    : "没有自动模板也可继续：生成官方组件暂存包，或使用自己的 EFI。"}
              </small>
            </div>
            {!previewReport && (
              <button type="button" onClick={continueToAssembly} disabled={hasFatalManifestFailure}>
                继续 EFI 组装 →
              </button>
            )}
          </section>

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
            <details className="discovery-ledger report-disclosure">
              <summary>
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
              </summary>

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
            </details>
          )}

          <details className="report-section report-disclosure">
            <summary className="section-heading">
              <div>
                <p className="eyebrow">MODULE MATRIX</p>
                <h2>模块化适配矩阵</h2>
              </div>
              <span className="section-count">{report.modules.length} 个模块</span>
            </summary>
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
          </details>

          <details className="report-section report-disclosure">
            <summary className="section-heading">
              <div>
                <p className="eyebrow">RULE RESOLUTION</p>
                <h2>逐项判断</h2>
              </div>
              <span className="section-count">{report.findings.length} 个检查点</span>
            </summary>
            <div className="finding-list">
              {report.findings.map((finding) => (
                <FindingRow key={finding.subjectId} finding={finding} />
              ))}
            </div>
          </details>
        </main>

        <aside className="result-rail">
          <section className="confidence-panel">
            <p className="eyebrow">BUILD CONFIDENCE</p>
            <div className="grade-line">
              <strong>{previewReport ? "—" : report.confidence}</strong>
              <div>
                <span>
                  {previewReport
                    ? "演示结果 · 仅供预览"
                    : report.recommended
                      ? "可生成候选方案"
                      : "实验模式 · 允许继续"}
                </span>
                <small>目标：macOS {macOSNames[targetMacOS]}</small>
              </div>
            </div>
            <div className="coverage-meter" aria-label={`规则识别度 ${report.coverage}%，不是安装成功率`}>
              <span style={{ width: `${report.coverage}%` }} />
            </div>
            <div className="coverage-copy">
              <span>规则识别度 · 不是成功率</span>
              <strong>{report.coverage}%</strong>
            </div>
          </section>

          <section className="plan-panel">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">RESOLVED PLAN</p>
                <h2>{previewReport ? "示例候选" : "候选构建"}</h2>
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
                      {previewReport
                        ? "演示数据 + 锁定组件（不生成）"
                        : hasCompatibilityWarnings
                          ? "锁定组件 + 实验规则"
                          : "锁定组件 + 动态规则"}
                    </dd>
                  </div>
                  {exactCommunityProfile && (
                    <div>
                      <dt>审核基线</dt>
                      <dd>{exactCommunityProfile.profile.title}（仅参考，未自动导入）</dd>
                    </div>
                  )}
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
                  disabled={hasFatalManifestFailure || !hardwareInputReady}
                >
                  <span>
                    {previewReport
                      ? "先扫描或导入本机报告"
                      : hasFatalManifestFailure
                        ? "结构或组件完整性失败"
                        : hasCompatibilityWarnings
                          ? "以实验模式继续"
                          : "继续下一步"}
                  </span>
                  <strong>
                    {previewReport
                      ? "当前仅可预览"
                      : hasFatalManifestFailure
                        ? "已停止生成"
                        : "EFI 组装  03 →"}
                  </strong>
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
                  disabled={hasFatalManifestFailure || !hardwareInputReady}
                >
                  {previewReport
                    ? "扫描或导入后可导出清单"
                    : hasFatalManifestFailure
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
                <h2 ref={workflowHeadingRef} tabIndex={-1}>EFI 组装工作区</h2>
                <p className="subcopy">
                  下载并校验官方组件，或验证你已有的完整 EFI。硬件警告不会剥夺继续权，结构损坏会停止。
                </p>
              </div>
              <span className={`assembly-mode ${hasCompatibilityWarnings ? "is-experimental" : ""}`}>
                {!buildPlan.autoConfigSupported
                  ? "手动组件模式"
                  : hasCompatibilityWarnings
                    ? "实验候选模式"
                    : "候选模式"}
              </span>
            </header>

            {hasCompatibilityWarnings && (
              <div className="experimental-warning assembly-warning" role="status">
                <strong>保留用户选择</strong>
                <span>当前硬件存在兼容性警告，清单仍可导出；它不会被标记为工具推荐或实机验证通过。</span>
              </div>
            )}
            {!hasNativeRuntime && (
              <div className="native-preview-note" role="status">
                <strong>当前是界面预览</strong>
                <span>文件选择、组件下载、EFI 校验和安全复制只在安装后的 Windows 桌面版中启用。</span>
              </div>
            )}
            <section className="assembly-route-callout" aria-label="推荐组装顺序">
              <strong>
                {buildPlan.autoConfigSupported
                  ? "第一次组装，建议先走 A 路径"
                  : "当前没有自动配置模板，请选择手动路径"}
              </strong>
              {buildPlan.autoConfigSupported ? (
                <ol>
                  <li>生成项目候选 EFI</li>
                  <li>按需加入个人组件或完整 EFI</li>
                  <li>结构与 ocvalidate 通过后再复制测试</li>
                </ol>
              ) : (
                <ol>
                  <li>生成官方组件暂存包</li>
                  <li>提供完整 config.plist，或导入自己的 EFI</li>
                  <li>结构与 ocvalidate 通过后再复制测试</li>
                </ol>
              )}
            </section>
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
                          disabled={assemblyBusy !== null}
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
                  {buildPlan.intelClockMode && (
                    <div className="clock-profile-row">
                      <dt>系统时钟</dt>
                      <dd>
                        <select
                          className="inline-option"
                          value={intelClockMode ?? "auto"}
                          disabled={assemblyBusy !== null}
                          onChange={(event) => {
                            const value = event.target.value;
                            setIntelClockMode(
                              value === "auto" ? undefined : (value as "awac" | "manual"),
                            );
                            resetBuildOutputs();
                          }}
                          aria-label="Intel AWAC 或 RTC0 路径"
                        >
                          <option value="auto">自动：预编译 AWAC（候选）</option>
                          <option value="awac">使用 AWAC（已核对 STAS / Legacy RTC）</option>
                          <option value="manual">手动 RTC0 / SSDTTime（不自动配置）</option>
                        </select>
                        <div className="clock-evidence-actions">
                          <button
                            className="clock-evidence-button"
                            type="button"
                            onClick={analyzeAcpiClock}
                            disabled={assemblyBusy !== null || !hasNativeRuntime}
                          >
                            {assemblyBusy === "acpi-analyze" ? "正在校验 DSDT…" : "选择 DSDT.aml 获取静态证据"}
                          </button>
                        </div>
                        {intelClockEvidence && (
                          <section className={`clock-evidence evidence-${intelClockEvidence.confidence}`}>
                            <div>
                              <strong>DSDT 静态线索</strong>
                              <span>
                                {intelClockEvidence.confidence === "strong-clue"
                                  ? "强线索"
                                  : intelClockEvidence.confidence === "possible-clue"
                                    ? "可能相关"
                                    : "证据不足"}
                              </span>
                            </div>
                            <code title={intelClockEvidence.sha256}>
                              {intelClockEvidence.sourceName} · {intelClockEvidence.sha256.slice(0, 12)}…
                            </code>
                            <ul>
                              <li>ACPI000E {intelClockEvidence.hasAwacDeviceId ? "已发现" : "未发现"}</li>
                              <li>PNP0B00 {intelClockEvidence.hasLegacyRtcId ? "已发现" : "未发现"}</li>
                              <li>STAS {intelClockEvidence.hasStasSymbol ? "已发现" : "未发现"}</li>
                            </ul>
                            <p>{intelClockEvidence.reasons[0]}</p>
                            <button type="button" onClick={applyAcpiClockSuggestion} disabled={assemblyBusy !== null}>
                              应用建议：{intelClockEvidence.suggestedMode === "awac" ? "AWAC 候选" : "手动核对"}
                            </button>
                            <small>{intelClockEvidence.warnings[0]}</small>
                          </section>
                        )}
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
                          disabled={assemblyBusy !== null}
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
                </div>

                <details className="advanced-build-options">
                  <summary>
                    <div>
                      <span>ADVANCED / OPTIONAL</span>
                      <strong>添加个人组件或融合两份完整 EFI</strong>
                      <small>先完成 A 或 B；只有确实需要保留专属配置时再展开。</small>
                    </div>
                  </summary>
                  <div className="advanced-build-grid">
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
                          disabled={assemblyBusy !== null || !scaffoldResult?.readyForCopy || !hasNativeRuntime}
                        >
                          {assemblyBusy === "component-scan" ? "正在安全扫描…" : "选择 Kext 或组件文件夹"}
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => scanUserComponents("files")}
                          disabled={assemblyBusy !== null || !scaffoldResult?.readyForCopy || !hasNativeRuntime}
                        >
                          选择 AML / EFI 文件
                        </button>
                      </div>
                      <div className="merge-readiness">
                        <span className={scaffoldResult?.readyForCopy ? "is-ready" : ""}>
                          A {scaffoldResult?.readyForCopy ? "项目候选已就绪" : "先生成项目候选"}
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
                            disabled={assemblyBusy !== null}
                            onChange={(event) => {
                              setMergePreference(event.target.value as "generated" | "custom");
                              setMergeResult(null);
                              setCopyResult(null);
                              setVerificationReview(null);
                              if (activeEfiSource === "merged") {
                                if (customEfiValidation?.valid) {
                                  setEfiValidation(customEfiValidation);
                                  setActiveEfiSource("custom");
                                } else {
                                  setEfiValidation(null);
                                  setActiveEfiSource(null);
                                }
                              }
                              setReportNotice("融合冲突优先级已经变化；需要重新生成融合副本后再进入复制与测试。");
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
                          disabled={assemblyBusy !== null || !scaffoldResult?.readyForCopy || !customEfiValidation?.valid || !hasNativeRuntime}
                        >
                          {assemblyBusy === "merge" ? "正在创建安全融合副本…" : "选择保存位置并融合"}
                        </button>
                      </div>
                      <div className="merge-readiness" aria-label="EFI 融合来源状态">
                        <span className={scaffoldResult?.readyForCopy ? "is-ready" : ""}>
                          A {scaffoldResult?.readyForCopy ? "完整候选已就绪" : "等待完整候选 EFI"}
                        </span>
                        <span className={customEfiValidation?.valid ? "is-ready" : ""}>
                          B {customEfiValidation?.valid ? "用户 EFI 结构已通过" : "等待用户 EFI 校验"}
                        </span>
                      </div>
                    </div>
                  </article>
                  </div>
                </details>

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
                              disabled={assemblyBusy !== null}
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
                        disabled={assemblyBusy !== null || !scaffoldResult?.readyForCopy}
                      >
                        {assemblyBusy === "component-merge" ? "正在生成组件融合副本…" : "按当前选择生成新副本"}
                      </button>
                    </div>
                  </section>
                )}

                {scaffoldResult && (
                  <div className={`execution-result ${scaffoldResult.readyForCopy ? "is-passed" : "is-warning"}`} role="status">
                    <strong>{scaffoldResult.readyForCopy ? "候选 EFI：ocvalidate 已通过" : "官方组件暂存包已生成"}</strong>
                    <code>{scaffoldResult.outputPath}</code>
                    <span>
                      {scaffoldResult.readyForCopy
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
              <button className="secondary-button" type="button" onClick={() => setWorkflowStep(2)} disabled={assemblyBusy !== null}>
                ← 返回兼容判断
              </button>
              <div>
                <button className="secondary-button" type="button" onClick={exportManifest} disabled={assemblyBusy !== null}>
                  导出构建清单
                </button>
                <button className="build-button" type="button" onClick={continueToCopyTest} disabled={!efiValidation?.valid || assemblyBusy !== null}>
                  {efiValidation?.valid ? "进入复制与测试 04 →" : "验证完整 EFI 后继续"}
                </button>
              </div>
            </div>
          </section>
        ) : workflowStep === 4 && efiValidation?.valid ? (
          <section className="assembly-workspace install-workspace">
            <header className="assembly-header">
              <div>
                <p className="eyebrow">STEP 04 / SAFE COPY</p>
                <h2 ref={workflowHeadingRef} tabIndex={-1}>复制 EFI 到测试分区或导出目录</h2>
                <p className="subcopy">将已完成当前检查的 EFI 复制到你选择的空位置。此版本不格式化磁盘、不创建分区、不覆盖已有文件。</p>
              </div>
              <span className="assembly-mode">只复制 / 不格式化</span>
            </header>

            {assemblyError && <div className="scan-error" role="alert"><strong>操作已停止</strong><span>{assemblyError}</span></div>}
            {reportNotice && <div className="report-notice" role="status">{reportNotice}</div>}
            <div className="experimental-warning assembly-warning" role="status">
              <strong>空文件夹不等于可启动介质</strong>
              <span>如果只选择普通文件夹，结果只能用于导出和备份。需要真机启动时，请先自行准备独立 U 盘的 FAT32 EFI 分区，挂载后选择其根目录。</span>
            </div>
            <ol className="copy-journey" aria-label="复制和测试顺序">
              <li className="is-complete">
                <span>01</span><div><strong>确认来源</strong><small>当前 EFI 已通过可用的静态结构检查；受控候选会额外显示 ocvalidate 结果。</small></div>
              </li>
              <li className={copyResult ? "is-complete" : "is-active"}>
                <span>02</span><div><strong>复制到空目录</strong><small>工具拒绝覆盖任何已有文件。</small></div>
              </li>
              <li className={copyResult ? "is-active" : ""}>
                <span>03</span><div><strong>从独立介质启动</strong><small>进入 OpenCore 或 Recovery 后再记录真机结果。</small></div>
              </li>
            </ol>
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

            {copyResult && (
              <div className="install-complete" role="status">
                <strong>EFI 已安全复制</strong>
                <code>{copyResult.targetPath}</code>
                <span>共复制 {copyResult.filesCopied} 个文件。如果目标是已挂载的 EFI 分区，下一步才是在目标电脑上测试 Picker 和 Recovery。</span>
              </div>
            )}

            <div className="assembly-actions">
              <button className="secondary-button" type="button" onClick={() => setWorkflowStep(3)} disabled={copyBusy}>← 返回 EFI 组装</button>
              <div>
                <span>只接受空目录；发现已有内容将自动停止</span>
                <button className="secondary-button" type="button" onClick={exportHandoffSummary} disabled={copyBusy}>
                  导出转移 / 求助摘要
                </button>
                <button className="build-button" type="button" onClick={copyValidatedEfi} disabled={copyBusy}>
                  {copyBusy ? "正在安全复制…" : copyResult ? "重新选择空位置" : "选择空位置并复制 EFI"}
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
        <span>EFI Forge v0.1.12-dev</span>
        <p>
          非 Apple 官方工具 · 当前数据来自{sourceCopy[scanSource]}
        </p>
      </footer>
    </div>
  );
}

export default App;
