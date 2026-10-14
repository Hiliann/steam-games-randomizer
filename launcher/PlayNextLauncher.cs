using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("Play Next")]
[assembly: AssemblyDescription("Steam Games Randomizer")]
[assembly: AssemblyProduct("Play Next")]
[assembly: AssemblyCompany("Hiliann")]
[assembly: AssemblyVersion("2.2.0.0")]
[assembly: AssemblyFileVersion("2.2.0.0")]

internal static class PlayNextLauncher
{
    internal static string DirectoryPath;
    internal static bool Russian = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "ru";
    internal static string Text(string ru, string en) { return Russian ? ru : en; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern bool SetDllDirectory(string path);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr handle);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr handle, int command);

    [STAThread]
    private static void Main(string[] args)
    {
        DirectoryPath = AppDomain.CurrentDomain.BaseDirectory;
        if (!File.Exists(Path.Combine(DirectoryPath, "start.ps1"))) DirectoryPath = Path.GetFullPath(Path.Combine(DirectoryPath, ".."));
        AppDomain.CurrentDomain.AssemblyResolve += delegate(object sender, ResolveEventArgs request) {
            string name = new AssemblyName(request.Name).Name;
            if (name != "Microsoft.Web.WebView2.Core" && name != "Microsoft.Web.WebView2.WinForms") return null;
            string file = Path.Combine(DirectoryPath, "runtime", "desktop", name + ".dll");
            return File.Exists(file) ? Assembly.LoadFrom(file) : null;
        };
        SetDllDirectory(Path.Combine(DirectoryPath, "runtime", "desktop"));
        string inheritedPath = Environment.GetEnvironmentVariable("Path") ?? Environment.GetEnvironmentVariable("PATH");
        Environment.SetEnvironmentVariable("PATH", null); Environment.SetEnvironmentVariable("Path", null);
        if (!String.IsNullOrEmpty(inheritedPath)) Environment.SetEnvironmentVariable("Path", inheritedPath);
        try
        {
            bool headless = false;
            bool minimized = false;
            int port = 0;
            for (int index = 0; index < args.Length; index++)
            {
                if (args[index] == "--no-browser") headless = true;
                else if (args[index] == "--minimized") minimized = true;
                else if (args[index] == "--port" && index + 1 < args.Length && Int32.TryParse(args[++index], out port) && port >= 1024 && port <= 65535) { }
                else throw new ArgumentException("Unknown launch option or invalid port.");
            }
            if (headless) { RunStarter("-NoBrowser" + (port > 0 ? " -Port " + port : "")); return; }
            string identity;
            using (SHA256 hash = SHA256.Create()) identity = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(DirectoryPath.ToLowerInvariant()))).Replace("-", "");
            using (Mutex mutex = new Mutex(false, "Local\\PlayNext-" + identity))
            {
                bool acquired;
                try { acquired = mutex.WaitOne(0); } catch (AbandonedMutexException) { acquired = true; }
                if (!acquired)
                {
                    foreach (Process process in Process.GetProcessesByName("Play Next"))
                    {
                        try { if (Path.GetDirectoryName(process.MainModule.FileName).Equals(DirectoryPath.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase)) { ShowWindow(process.MainWindowHandle, 9); SetForegroundWindow(process.MainWindowHandle); } } catch { }
                        process.Dispose();
                    }
                    return;
                }
                try { RunWindow(port, minimized); } finally { mutex.ReleaseMutex(); }
            }
        }
        catch (Exception error)
        {
            Log(error);
            MessageBox.Show(Text("Не удалось открыть Play Next. Подробнее в .launcher-error.log.\n", "Could not open Play Next. See .launcher-error.log.\n") + error.Message, "Play Next", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Environment.ExitCode = 1;
        }
    }

    // Register assembly resolution before any WebView2 types are loaded.
    private static void RunWindow(int port, bool minimized)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        PlayNextWindow window = new PlayNextWindow(port);
        if (minimized) window.WindowState = FormWindowState.Minimized;
        Application.Run(window);
    }
    internal static void RunStarter(string flags)
    {
        string script = Path.Combine(DirectoryPath, "start.ps1");
        if (!File.Exists(script)) throw new FileNotFoundException("Extract the complete Play Next ZIP before opening it.");
        ProcessStartInfo info = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"));
        info.WorkingDirectory = DirectoryPath; info.UseShellExecute = false; info.CreateNoWindow = true;
        info.WindowStyle = ProcessWindowStyle.Hidden; info.RedirectStandardOutput = true; info.RedirectStandardError = true;
        info.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + script + "\" " + flags;
        using (Process process = Process.Start(info))
        {
            Task<string> output = process.StandardOutput.ReadToEndAsync();
            Task<string> errors = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(45000)) { process.Kill(); throw new TimeoutException("Play Next startup timed out."); }
            if (process.ExitCode != 0) throw new InvalidOperationException(output.Result + errors.Result);
        }
    }
    internal static void Log(Exception error) { try { File.AppendAllText(Path.Combine(DirectoryPath, ".launcher-error.log"), DateTime.UtcNow.ToString("o") + " " + error + Environment.NewLine); } catch { } }
}

internal sealed class StartupPanel : Panel
{
    private readonly System.Windows.Forms.Timer animation = new System.Windows.Forms.Timer();
    private readonly Stopwatch elapsed = Stopwatch.StartNew();
    private Image artwork;
    private bool busy;
    [DllImport("user32.dll")] private static extern bool SystemParametersInfo(uint action, uint parameter, out bool value, uint flags);
    private readonly bool animate;
    internal StartupPanel()
    {
        DoubleBuffered = true;
        bool effects = true; try { SystemParametersInfo(0x1042, 0, out effects, 0); } catch { }
        animate = effects;
        try { using (var bytes = new MemoryStream(File.ReadAllBytes(Path.Combine(PlayNextLauncher.DirectoryPath, "public", "icon.png")))) using (var source = Image.FromStream(bytes)) artwork = new Bitmap(source); } catch { }
        animation.Interval = 40;
        animation.Tick += delegate { Invalidate(); };
        VisibleChanged += delegate { RefreshAnimation(); };
    }
    internal void SetBusy(bool value) { busy = value; RefreshAnimation(); Invalidate(); }
    internal void RefreshAnimation()
    {
        Form owner = FindForm();
        if (animate && busy && Visible && owner != null && owner.WindowState != FormWindowState.Minimized) animation.Start(); else animation.Stop();
    }
    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        Graphics g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias;
        float scale = g.DpiX / 96f, x = ClientSize.Width / 2f, y = ClientSize.Height / 2f - 70 * scale;
        float radius = 82 * scale;
        float angle = animate && busy ? (float)(elapsed.Elapsed.TotalSeconds * 90 % 360) : -90;
        using (var glow = new GraphicsPath()) {
            glow.AddEllipse(x - radius * 1.7f, y - radius * 1.7f, radius * 3.4f, radius * 3.4f);
            using (var brush = new PathGradientBrush(glow)) { brush.CenterColor = Color.FromArgb(24, 194, 232, 145); brush.SurroundColors = new[] { Color.Transparent }; g.FillPath(brush, glow); }
        }
        using (var baseRing = new Pen(Color.FromArgb(45, 194, 232, 145), 2 * scale)) g.DrawEllipse(baseRing, x - radius, y - radius, radius * 2, radius * 2);
        using (var ring = new Pen(Color.FromArgb(194, 232, 145), 3 * scale)) { ring.StartCap = ring.EndCap = LineCap.Round; g.DrawArc(ring, x - radius, y - radius, radius * 2, radius * 2, angle, 100); }
        using (var ring = new Pen(Color.FromArgb(95, 194, 232, 145), 2 * scale)) g.DrawArc(ring, x - radius + 12 * scale, y - radius + 12 * scale, (radius - 12 * scale) * 2, (radius - 12 * scale) * 2, -angle, 80);
        float size = 104 * scale;
        if (artwork != null) { g.InterpolationMode = InterpolationMode.HighQualityBicubic; g.DrawImage(artwork, x - size / 2, y - size / 2, size, size); }
        using (var font = new Font("Segoe UI", 28 * scale, FontStyle.Bold, GraphicsUnit.Pixel)) using (var brush = new SolidBrush(ForeColor)) using (var format = new StringFormat { Alignment = StringAlignment.Center }) g.DrawString("Play Next", font, brush, new RectangleF(0, y + 102 * scale, ClientSize.Width, 48 * scale), format);
    }
    protected override void Dispose(bool disposing)
    {
        if (disposing) { animation.Stop(); animation.Dispose(); if (artwork != null) { artwork.Dispose(); artwork = null; } }
        base.Dispose(disposing);
    }
}

internal sealed class PlayNextWindow : Form
{
    private WebView2 view;
    private readonly StartupPanel status = new StartupPanel();
    private readonly Label message = new Label();
    private readonly Button retry = new Button();
    private readonly HttpClient http = new HttpClient(new HttpClientHandler { UseProxy = false });
    private readonly System.Windows.Forms.Timer healthTimer = new System.Windows.Forms.Timer();
    private string origin;
    private bool recovering, closing, updating, serverStarted;
    private int failures, recoveries;
    private readonly int preferredPort;
    private readonly int owner = Process.GetCurrentProcess().Id;
    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr handle, int attribute, ref int value, int size);

    internal PlayNextWindow(int port)
    {
        preferredPort = port; Text = "Play Next"; BackColor = Color.FromArgb(17,20,18); ForeColor = Color.FromArgb(236,242,230);
        ClientSize = new Size(1280, 820); MinimumSize = new Size(760, 580); StartPosition = FormStartPosition.CenterScreen; AutoScaleMode = AutoScaleMode.Dpi;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        status.Dock = DockStyle.Fill; message.BackColor = Color.Transparent; message.TextAlign = ContentAlignment.TopCenter; message.Font = new Font("Segoe UI", 12);
        status.Resize += delegate { using (Graphics graphics = status.CreateGraphics()) { float scale = graphics.DpiX / 96f; message.Bounds = new Rectangle((int)(24 * scale), status.Height / 2 + (int)(88 * scale), Math.Max(0, status.Width - (int)(48 * scale)), Math.Max(0, status.Height / 2 - (int)(160 * scale))); } };
        retry.Dock = DockStyle.Bottom; retry.Height = 56; retry.Text = PlayNextLauncher.Text("Повторить запуск", "Try again"); retry.FlatStyle = FlatStyle.Flat;
        retry.BackColor = Color.FromArgb(194,232,145); retry.ForeColor = Color.FromArgb(24,34,18); retry.Visible = false;
        retry.Click += async delegate { recoveries = 0; await StartAsync(); };
        status.Controls.Add(message); status.Controls.Add(retry); Controls.Add(status);
        http.Timeout = TimeSpan.FromSeconds(2); healthTimer.Interval = 3000; healthTimer.Tick += async delegate { await CheckHealthAsync(); };
        Resize += async delegate { status.RefreshAnimation(); if (WindowState != FormWindowState.Minimized && view == null && serverStarted) await StartAsync(); };
        Shown += async delegate { int dark = 1; try { DwmSetWindowAttribute(Handle, 20, ref dark, 4); } catch { } await StartAsync(); };
        FormClosing += delegate { closing = true; healthTimer.Stop(); if (view != null) view.Dispose(); };
        FormClosed += delegate { http.Dispose(); if (serverStarted && !updating) { try { PlayNextLauncher.RunStarter("-Stop -DesktopOwner " + owner); } catch (Exception error) { PlayNextLauncher.Log(error); } } };
    }
    private void ShowStatus(string text, bool canRetry) { message.Text = text; retry.Visible = canRetry; status.Visible = true; status.SetBusy(!canRetry); status.BringToFront(); }
    private async Task StartAsync()
    {
        if (recovering || closing || updating) return;
        recovering = true; healthTimer.Stop(); ShowStatus(PlayNextLauncher.Text("Открываем твою библиотеку…", "Opening your library…"), false);
        try
        {
            CoreWebView2Environment.GetAvailableBrowserVersionString();
            await Task.Run(() => PlayNextLauncher.RunStarter("-NoBrowser -DesktopOwner " + owner + (preferredPort > 0 ? " -Port " + preferredPort : "")));
            serverStarted = true;
            if (closing) return;
            var record = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(PlayNextLauncher.DirectoryPath, ".server-process.json"), Encoding.UTF8));
            int port = Convert.ToInt32(record["port"]);
            if (port < 1024 || port > 65535) throw new InvalidOperationException("Invalid local port.");
            origin = "http://127.0.0.1:" + port;
            if (!await HealthyAsync()) throw new InvalidOperationException("The local service is not responding.");
            // Creating a WebView controller in a minimized WinForms window can
            // fail with ERROR_BUSY. Start the service now and render on restore.
            if (view == null && WindowState == FormWindowState.Minimized) { failures = 0; healthTimer.Start(); return; }
            if (view == null)
            {
                view = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = BackColor }; Controls.Add(view); status.BringToFront();
                var options = new CoreWebView2EnvironmentOptions(); options.Language = CultureInfo.CurrentUICulture.Name;
                var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(PlayNextLauncher.DirectoryPath, "data", "webview"), options);
                if (closing) return;
                await view.EnsureCoreWebView2Async(environment);
                view.CoreWebView2.Settings.AreDevToolsEnabled = false; view.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false; view.CoreWebView2.Settings.IsStatusBarEnabled = false;
                view.CoreWebView2.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e) { if (!IsLocal(e.Uri)) { e.Cancel = true; OpenExternal(e.Uri); } };
                view.CoreWebView2.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e) { e.Handled = true; OpenExternal(e.Uri); };
                view.CoreWebView2.PermissionRequested += delegate(object sender, CoreWebView2PermissionRequestedEventArgs e) { e.State = CoreWebView2PermissionState.Deny; };
                view.CoreWebView2.WebMessageReceived += async delegate(object sender, CoreWebView2WebMessageReceivedEventArgs e) { if (!IsLocal(e.Source)) return; try { string command = e.TryGetWebMessageAsString(); if (command == "update-starting") { updating = true; Close(); } else if (command == "recover") { recoveries = 0; await StartAsync(); } } catch (Exception error) { PlayNextLauncher.Log(error); } };
                view.CoreWebView2.ProcessFailed += async delegate { if (!closing && !updating) { view.Dispose(); Controls.Remove(view); view = null; if (++recoveries <= 3) await StartAsync(); else ShowStatus(PlayNextLauncher.Text("Окно приложения не отвечает. Повтори запуск.", "The app window is not responding. Try again."), true); } };
                view.CoreWebView2.NavigationCompleted += delegate(object sender, CoreWebView2NavigationCompletedEventArgs e) { if (e.IsSuccess) status.Visible = false; else ShowStatus(PlayNextLauncher.Text("Связь прервана. Восстанавливаем приложение…", "Connection interrupted. Recovering the app…"), true); };
            }
            view.CoreWebView2.Navigate(origin + "/"); failures = 0; healthTimer.Start();
        }
        catch (WebView2RuntimeNotFoundException error)
        {
            PlayNextLauncher.Log(error); ShowStatus(PlayNextLauncher.Text("Нужен Microsoft Edge WebView2 Runtime.\nУстанови его с сайта Microsoft и нажми «Повторить запуск».", "Microsoft Edge WebView2 Runtime is required.\nInstall it from Microsoft, then click Try again."), true);
            if (MessageBox.Show(PlayNextLauncher.Text("Открыть страницу загрузки WebView2 на сайте Microsoft?", "Open the WebView2 download page on Microsoft's website?"), "Play Next", MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes) OpenExternal("https://developer.microsoft.com/microsoft-edge/webview2/");
        }
        catch (Exception error) {
            PlayNextLauncher.Log(error);
            if (!closing) {
                if (view != null && view.CoreWebView2 == null) { WebView2 failed = view; view = null; Controls.Remove(failed); failed.Dispose(); }
                ShowStatus(PlayNextLauncher.Text("Не удалось запустить приложение.\n", "Could not start the app.\n") + error.Message, true);
                if (serverStarted) healthTimer.Start();
            }
        }
        finally { recovering = false; }
    }
    private bool IsLocal(string url) { Uri uri; return Uri.TryCreate(url, UriKind.Absolute, out uri) && uri.GetLeftPart(UriPartial.Authority) == origin; }
    private void OpenExternal(string url)
    {
        Uri uri; if (!Uri.TryCreate(url, UriKind.Absolute, out uri) || uri.Scheme != "https" || !String.IsNullOrEmpty(uri.UserInfo)) return;
        if (uri.Host != "github.com" && uri.Host != "store.steampowered.com" && uri.Host != "developer.microsoft.com" && uri.Host != "learn.microsoft.com") return;
        try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); } catch (Exception error) { PlayNextLauncher.Log(error); }
    }
    private async Task<bool> HealthyAsync()
    {
        try { string json = await http.GetStringAsync(origin + "/api/health"); var health = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json); return (string)health["app"] == "steam-games-randomizer" && Convert.ToInt32(health["desktopOwner"]) == owner; } catch { return false; }
    }
    private async Task CheckHealthAsync()
    {
        if (recovering || closing || updating) return;
        healthTimer.Stop();
        if (await HealthyAsync()) { failures = 0; healthTimer.Start(); return; }
        if (closing || updating) return;
        if (++failures < 2) { healthTimer.Start(); return; }
        if (++recoveries <= 3) await StartAsync();
        else ShowStatus(PlayNextLauncher.Text("Связь с приложением прервалась.\nТвои категории и настройки сохранены. Можно повторить запуск.", "Connection lost.\nYour categories and settings are saved. You can try again."), true);
    }
}
