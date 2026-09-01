import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultScript = path.join(moduleDirectory, '..', 'scripts', 'windows-integration.ps1');
export const MAX_WINDOWS_SETTINGS_BYTES = 256;

function normalizeStatus(value) {
  if (!value || typeof value !== 'object' || typeof value.supported !== 'boolean') throw new Error('Windows returned an invalid integration status.');
  return {
    supported: value.supported,
    desktopShortcut: value.supported && value.desktopShortcut === true,
    startup: value.supported && value.startup === true,
  };
}

async function runPowerShell(scriptPath, action) {
  const root = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows';
  const powershell = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return execFileAsync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Action', action], {
    cwd: path.dirname(scriptPath),
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 64 * 1024,
  });
}

export function createWindowsIntegration({ platform = process.platform, scriptPath = defaultScript, runner = runPowerShell } = {}) {
  const invoke = async action => {
    if (platform !== 'win32') return { supported: false, desktopShortcut: false, startup: false };
    try {
      const result = await runner(scriptPath, action);
      const output = typeof result === 'string' ? result : result.stdout;
      return normalizeStatus(JSON.parse(String(output).replace(/^\uFEFF/, '').trim()));
    } catch (cause) {
      const error = new Error('Не удалось изменить настройки Windows. Проверь доступ к рабочему столу и папке автозагрузки.');
      error.status = 503;
      error.cause = cause;
      throw error;
    }
  };

  return {
    read: () => invoke('Status'),
    change(body) {
      if (!body || typeof body !== 'object' || Array.isArray(body) || !['desktopShortcut', 'startup'].includes(body.setting) || typeof body.enabled !== 'boolean' || Object.keys(body).length !== 2) {
        throw Object.assign(new Error('Некорректная настройка Windows.'), { status: 400 });
      }
      const action = body.setting === 'desktopShortcut'
        ? body.enabled ? 'DesktopOn' : 'DesktopOff'
        : body.enabled ? 'StartupOn' : 'StartupOff';
      return invoke(action);
    },
  };
}
