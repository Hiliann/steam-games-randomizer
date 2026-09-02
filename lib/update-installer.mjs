import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseVersion } from './update-check.mjs';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultScript = path.join(moduleDirectory, '..', 'scripts', 'apply-update.ps1');

function expectedUrl(value, version, checksum = false) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    const suffix = checksum ? '.sha256' : '';
    return url.protocol === 'https:' && url.hostname === 'github.com'
      && url.pathname === `/Hiliann/steam-games-randomizer/releases/download/v${version}/PlayNext-${version}-win-x64.zip${suffix}`;
  } catch { return false; }
}

function runPowerShell(scriptPath, options) {
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows';
  const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(powershell, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
    '-Version', options.version, '-DownloadUrl', options.downloadUrl, '-ChecksumUrl', options.checksumUrl,
    '-ProcessId', String(options.processId), '-Port', String(options.port),
  ], { cwd: path.dirname(scriptPath), windowsHide: true, detached: true, stdio: 'ignore' });
  child.unref();
}

export function createUpdateInstaller({ platform = process.platform, scriptPath = defaultScript, runner = runPowerShell } = {}) {
  let installing = false;
  return {
    install(options) {
      if (installing) throw Object.assign(new Error('Установка обновления уже началась.'), { status: 409 });
      if (platform !== 'win32') throw Object.assign(new Error('Автоматическая установка доступна только в Windows.'), { status: 503 });
      if (!options || !parseVersion(options.version) || !expectedUrl(options.downloadUrl, options.version)
        || !expectedUrl(options.checksumUrl, options.version, true)
        || !Number.isInteger(options.processId) || options.processId < 1
        || !Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
        throw Object.assign(new Error('Релиз не прошёл проверку перед установкой.'), { status: 400 });
      }
      try {
        runner(scriptPath, options);
        installing = true;
        return { status: 'installing', targetVersion: options.version };
      } catch (cause) {
        const error = new Error('Не удалось запустить установщик обновления.');
        error.status = 503; error.cause = cause;
        throw error;
      }
    },
  };
}
