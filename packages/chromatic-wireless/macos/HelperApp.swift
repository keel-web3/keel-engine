// SPDX-License-Identifier: MIT
import AppKit
import Foundation

final class HelperApp: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var process: Process?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?
    private var buffer = ""
    private var launchKey: String?
    private var status = NSTextField(wrappingLabelWithString: "Starting local helper…")
    private var openCrucible: NSButton!
    private var openEgress: NSButton!
    private var startButton: NSButton!
    private var stopping = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let appMenuItem = NSMenuItem()
        menu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit Chromatic Helper", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu
        NSApp.mainMenu = menu
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 540, height: 410), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Chromatic Helper"
        window.isReleasedWhenClosed = false
        let title = NSTextField(labelWithString: "Chromatic Wi-Fi Helper")
        title.font = .boldSystemFont(ofSize: 24)
        status.font = .systemFont(ofSize: 15, weight: .medium)
        let explanation = NSTextField(wrappingLabelWithString: "Keep this app open, then open your game’s site below. Your Chromatic needs Shiny Relay Wi-Fi and nearby link enabled on the same network.")
        let limits = NSTextField(wrappingLabelWithString: "Game-link connectivity preview. This helper does not flash cartridges, install firmware, or enable internet remote play. No login or admin access is needed.")
        limits.textColor = .secondaryLabelColor
        openCrucible = NSButton(title: "Open CRUCIBLE", target: self, action: #selector(openCrucibleSite))
        openEgress = NSButton(title: "Open EGRESS", target: self, action: #selector(openEgressSite))
        startButton = NSButton(title: "Start helper", target: self, action: #selector(startHelper))
        let quit = NSButton(title: "Quit", target: NSApp, action: #selector(NSApplication.terminate(_:)))
        let source = NSButton(title: "Source on GitHub", target: self, action: #selector(openSource))
        let sites = NSStackView(views: [openCrucible, openEgress])
        sites.orientation = .horizontal
        sites.spacing = 12
        let bottom = NSStackView(views: [startButton, source, quit])
        bottom.orientation = .horizontal
        bottom.spacing = 12
        let stack = NSStackView(views: [title, status, explanation, sites, limits, bottom])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 24)
        ])
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        startHelper()
    }
    private func setReady(_ ready: Bool) {
        openCrucible.isEnabled = ready
        openEgress.isEnabled = ready
        startButton.isEnabled = process == nil
    }
    @objc private func startHelper() {
        guard process == nil, !stopping else { return }
        launchKey = nil
        buffer = ""
        guard let executable = Bundle.main.url(forAuxiliaryExecutable: "chromatic-wifi") else {
            status.stringValue = "Helper missing. Download a fresh copy from the official GitHub release."
            setReady(false)
            return
        }
        let child = Process()
        child.executableURL = executable
        let output = Pipe(), errors = Pipe()
        stdoutPipe = output
        stderrPipe = errors
        child.standardOutput = output
        child.standardError = errors
        // Keep the pipe open: if the app crashes, EOF tells the child to exit.
        let input = Pipe()
        child.standardInput = input
        child.environment = ProcessInfo.processInfo.environment.merging(["CHROMATIC_APP_PARENT": "1"]) { _, new in new }
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            DispatchQueue.main.async { self?.consume(data) }
        }
        errors.fileHandleForReading.readabilityHandler = { handle in _ = handle.availableData }
        child.terminationHandler = { [weak self] child in
            output.fileHandleForReading.readabilityHandler = nil
            errors.fileHandleForReading.readabilityHandler = nil
            // Capturing input retains the parent's write end throughout the child lifetime.
            try? input.fileHandleForWriting.close()
            DispatchQueue.main.async {
                guard let self = self, self.process === child else { return }
                self.process = nil
                self.launchKey = nil
                self.setReady(false)
                if !self.stopping { self.status.stringValue = "Helper stopped. Close another running copy, then choose Start helper. No device is connected." }
            }
        }
        process = child
        setReady(false)
        status.stringValue = "Starting local helper…"
        do { try child.run() }
        catch {
            output.fileHandleForReading.readabilityHandler = nil
            errors.fileHandleForReading.readabilityHandler = nil
            process = nil
            status.stringValue = "Could not start the signed helper. Re-download the release or check macOS Privacy & Security."
            setReady(false)
        }
    }
    private func consume(_ data: Data) {
        guard let text = String(data: data, encoding: .utf8), !stopping else { return }
        buffer += text
        if buffer.count > 4096 { buffer = String(buffer.suffix(4096)) }
        let prefix = "Open https://crucible.onkeel.io/chromatic/#wifi-bridge="
        while let newline = buffer.firstIndex(of: "\n") {
            let line = String(buffer[..<newline]).trimmingCharacters(in: .whitespacesAndNewlines)
            buffer.removeSubrange(...newline)
            guard line.hasPrefix(prefix) else { continue }
            let key = String(line.dropFirst(prefix.count))
            guard key.count == 64, key.allSatisfy({ "0123456789abcdef".contains($0) }), process?.isRunning == true else { continue }
            launchKey = key
            status.stringValue = "Ready · local helper running. Device response is checked on the site."
            setReady(true)
        }
    }
    private func openSite(_ site: String) {
        guard let key = launchKey, process?.isRunning == true,
              let url = URL(string: "https://\(site).onkeel.io/chromatic/#wifi-bridge=\(key)") else { return }
        NSWorkspace.shared.open(url)
    }
    @objc private func openCrucibleSite() { openSite("crucible") }
    @objc private func openEgressSite() { openSite("egress") }
    @objc private func openSource() { NSWorkspace.shared.open(URL(string: "https://github.com/Ravonus/chromatic-helper")!) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) {
        stopping = true
        launchKey = nil
        if let child = process, child.isRunning { child.terminate() }
    }
}
let app = NSApplication.shared
let delegate = HelperApp()
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
