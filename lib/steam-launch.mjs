import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultScript = path.join(moduleDirectory, '..', 'scripts', 'launch-steam.ps1');
const validAppId = id => typeof id === 'string' && /^[1-9]\d{0,9}$/.test(id) && Number(id) <= 0xffffffff;

async function runPowerShell(scriptPath, uri) {
  const root = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows';
  const powershell = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return execFileAsync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Uri', uri], {
    cwd: path.dirname(scriptPath), windowsHide: true, timeout: 15000, maxBuffer: 64 * 1024,
  });
}

export function createSteamLauncher({ platform = process.platform, scriptPath = defaultScript, runner = runPowerShell } = {}) {
  return {
    async launch(game) {
      if (!game || !validAppId(game.id) || typeof game.installed !== 'boolean') throw Object.assign(new Error('Укажи игру из текущей библиотеки.'), { status: 400 });
      if (platform !== 'win32') throw Object.assign(new Error('Запуск через Play Next доступен только в Windows.'), { status: 503 });
      const action = game.installed ? 'run' : 'install';
      const uri = `steam://${action}/${game.id}`;
      try {
        await runner(scriptPath, uri);
        return { status: 'opened', action };
      } catch (cause) {
        const error = new Error('Не удалось открыть Steam. Проверь, что клиент Steam установлен.');
        error.status = 503; error.cause = cause;
        throw error;
      }
    },
  };
}
