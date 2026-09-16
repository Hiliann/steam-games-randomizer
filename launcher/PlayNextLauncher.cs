using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("Play Next")]
[assembly: AssemblyDescription("Steam Games Randomizer")]
[assembly: AssemblyProduct("Play Next")]
[assembly: AssemblyCompany("Hiliann")]
[assembly: AssemblyVersion("1.9.0.0")]
[assembly: AssemblyFileVersion("1.9.0.0")]

internal static class PlayNextLauncher
{
    [STAThread]
    private static void Main(string[] args)
    {
        try
        {
            string appDirectory = AppDomain.CurrentDomain.BaseDirectory;
            string startScript = Path.Combine(appDirectory, "start.ps1");
            if (!File.Exists(startScript))
            {
                appDirectory = Path.GetFullPath(Path.Combine(appDirectory, ".."));
                startScript = Path.Combine(appDirectory, "start.ps1");
            }
            if (!File.Exists(startScript)) throw new FileNotFoundException("The start.ps1 file was not found next to Play Next.");

            bool noBrowser = false;
            int? port = null;
            for (int index = 0; index < args.Length; index++)
            {
                if (String.Equals(args[index], "--no-browser", StringComparison.OrdinalIgnoreCase)) noBrowser = true;
                else if (String.Equals(args[index], "--port", StringComparison.OrdinalIgnoreCase) && index + 1 < args.Length)
                {
                    int parsed;
                    if (!Int32.TryParse(args[++index], NumberStyles.None, CultureInfo.InvariantCulture, out parsed) || parsed < 1024 || parsed > 65535)
                        throw new ArgumentException("The port must be a number from 1024 to 65535.");
                    port = parsed;
                }
                else throw new ArgumentException("Unknown launch option.");
            }

            string system = Environment.GetFolderPath(Environment.SpecialFolder.System);
            string powershell = Path.Combine(system, @"WindowsPowerShell\v1.0\powershell.exe");
            // Some launch hosts supply both Path and PATH. Windows normally does
            // not, but Start-Process rejects such a duplicated environment block.
            string inheritedPath = Environment.GetEnvironmentVariable("Path") ?? Environment.GetEnvironmentVariable("PATH");
            Environment.SetEnvironmentVariable("PATH", null);
            Environment.SetEnvironmentVariable("Path", null);
            if (!String.IsNullOrEmpty(inheritedPath)) Environment.SetEnvironmentVariable("Path", inheritedPath);
            ProcessStartInfo process = new ProcessStartInfo();
            process.FileName = powershell;
            process.WorkingDirectory = appDirectory;
            process.UseShellExecute = true;
            process.WindowStyle = ProcessWindowStyle.Hidden;
            process.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + startScript + "\"";
            if (noBrowser) process.Arguments += " -NoBrowser";
            if (port.HasValue) process.Arguments += " -Port " + port.Value.ToString(CultureInfo.InvariantCulture);
            using (Process started = Process.Start(process))
            {
                if (started == null) throw new InvalidOperationException("Windows could not start Play Next.");
                started.WaitForExit();
                if (started.ExitCode != 0) throw new InvalidOperationException("Play Next could not start. See .server-error.log in the program folder for details.");
            }
        }
        catch (Exception error)
        {
            try
            {
                string folder = AppDomain.CurrentDomain.BaseDirectory;
                File.WriteAllText(Path.Combine(folder, ".launcher-error.log"), error.ToString());
            }
            catch { }
            MessageBox.Show(error.Message, "Play Next", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
