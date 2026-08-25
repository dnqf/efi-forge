import { useMemo, useRef, useState } from "react";
import { createEfiManifest, serializeEfiManifest } from "./build/createEfiManifest";
import { compatibilityRules } from "./data/rules";
import { communityProfiles } from "./data/communityProfiles";
import { hardwareFixtures } from "./data/hardwareFixtures";
import { sampleHardware } from "./data/sampleHardware";
import type {
  CompatibilityFinding,
  CompatibilityStatus,
  DeviceCategory,
  MacOSVersion,
  HardwareReport,
  HardwareReportSource,
} from "./domain/types";
import { createBuildPlan } from "./engine/createBuildPlan";
import { evaluateCompatibility } from "./engine/evaluateCompatibility";
import { resolveCommunityProfiles } from "./community/resolveCommunityProfiles";
import {
  nativeRuntimeAvailable,
  scanNativeHardware,
} from "./native/hardwareScanner";
import {
  buildEfiScaffold,
  copyEfiToEmptyTarget,
  selectUsbMap,
  validateCustomEfi,
  type EfiValidationResult,
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

function App() {
  const [workflowStep, setWorkflowStep] = useState<2 | 3 | 4>(2);
  const [targetMacOS, setTargetMacOS] = useState<MacOSVersion>("14");
  const [amdSetupVirtualMap, setAmdSetupVirtualMap] = useState(true);
  const [scanState, setScanState] = useState<"ready" | "scanning" | "complete">("complete");
  const [hardware, setHardware] = useState<HardwareReport>(sampleHardware);
  const [scanSource, setScanSource] = useState<HardwareReportSource>("demo");
  const [scanError, setScanError] = useState<string | null>(null);
  const [reportNotice, setReportNotice] = useState<string | null>(null);
  const [assemblyError, setAssemblyError] = useState<string | null>(null);
  const [assemblyBusy, setAssemblyBusy] = useState<"scaffold" | "validate" | null>(null);
  const [scaffoldResult, setScaffoldResult] = useState<ScaffoldResult | null>(null);
  const [efiValidation, setEfiValidation] = useState<EfiValidationResult | null>(null);
  const [usbMap, setUsbMap] = useState<UsbMapSelection | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [installResult, setInstallResult] = useState<InstallCopyResult | null>(null);
  const reportInputRef = useRef<HTMLInputElement>(null);
  const hasNativeRuntime = nativeRuntimeAvailable();

  const report = useMemo(
    () => evaluateCompatibility(hardware, targetMacOS, compatibilityRules),
    [hardware, targetMacOS],
  );
  const buildPlan = useMemo(
    () => createBuildPlan(hardware, report, { amdSetupVirtualMap, customUsbMapIncluded: usbMap !== null }),
    [hardware, report, amdSetupVirtualMap, usbMap],
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

  const primaryGpu = hardware.gpus[0];
  const primaryNetwork = hardware.network[0];
  const primaryStorage = hardware.storage[0];
  const hasCompatibilityWarnings = report.status !== "supported";
  const hasFatalManifestFailure =
    buildManifest?.checks.some((check) => check.status === "failed") ?? false;

  function resetBuildOutputs() {
    setAssemblyError(null);
    setScaffoldResult(null);
    setEfiValidation(null);
    setInstallResult(null);
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
          });
          setReportNotice(`候选 EFI 已一键生成并通过同版本 ocvalidate：${result.outputPath}`);
        } else {
          setEfiValidation(null);
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
        setEfiValidation(result);
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

  function continueToInstallMedia() {
    if (!efiValidation?.valid) {
      setAssemblyError("只有结构完整的 EFI 才能进入安装介质步骤。兼容性警告不会阻止这里，但结构损坏会停止。");
      return;
    }
    setAssemblyError(null);
    setWorkflowStep(4);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
              <code>{primaryGpu ? `${primaryGpu.vendorId}:${primaryGpu.deviceId}` : "----:----"}</code>
            </div>
            <div className="device-node node-network">
              <span>NETWORK</span>
              <strong>{primaryNetwork?.name ?? "未检测到物理网卡"}</strong>
              <code>{primaryNetwork ? `${primaryNetwork.vendorId}:${primaryNetwork.deviceId}` : "----:----"}</code>
            </div>
            <div className="device-node node-storage">
              <span>STORAGE</span>
              <strong>{primaryStorage?.name ?? "未检测到存储设备"}</strong>
              <code>{primaryStorage ? `${primaryStorage.vendorId}:${primaryStorage.deviceId}` : "----:----"}</code>
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
                          value={amdSetupVirtualMap ? "enabled" : "disabled"}
                          onChange={(event) => {
                            setAmdSetupVirtualMap(event.target.value === "enabled");
                            resetBuildOutputs();
                          }}
                          aria-label="AMD SetupVirtualMap"
                        >
                          <option value="enabled">开启（常见 BIOS）</option>
                          <option value="disabled">关闭（部分新版 BIOS）</option>
                        </select>
                      </dd>
                    </div>
                  )}
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
                        ? efiValidation.validationLevel === "ocvalidate-passed"
                          ? "候选 EFI：ocvalidate 已通过"
                          : "自有 EFI：仅结构检查通过"
                        : "EFI 结构损坏，已停止"}
                    </strong>
                    <code>{efiValidation.rootPath}</code>
                    {(efiValidation.valid ? efiValidation.warnings : efiValidation.errors).map((message) => <span key={message}>{message}</span>)}
                  </div>
                )}
              </section>
            </div>

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
                <h3>{efiValidation.validationLevel === "ocvalidate-passed" ? "ocvalidate 已通过的候选 EFI" : "仅结构检查通过的自有 EFI"}</h3>
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
        <span>EFI Forge v0.1.5</span>
        <p>
          非 Apple 官方工具 · 当前数据来自{sourceCopy[scanSource]}
        </p>
      </footer>
    </div>
  );
}

export default App;
