// Holz-Bauplaner als Windows-Programm: liefert die Web-App aus dem Ordner
// "web" über einen lokalen Server aus und zeigt sie in einem WebView2-Fenster.
package main

import (
	"embed"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
)

//go:embed web
var dateien embed.FS

// Fester Port, damit gespeicherte Projekte (localStorage) beim nächsten Start wieder da sind.
var ports = []string{"47811", "47812", "47813", "47814", "47815"}

// Öffnet Links mit target="_blank" im normalen Browser statt in einem neuen Fenster.
const initSkript = `
window.addEventListener("click", function (e) {
  var a = e.target.closest && e.target.closest("a[href]");
  if (a && a.target === "_blank" && /^https?:/.test(a.href)) {
    e.preventDefault();
    window.extern(a.href);
  }
}, true);
`

func main() {
	skala := dpiAktivieren()
	web, _ := fs.Sub(dateien, "web")
	listener := lauschen()
	if listener == nil {
		meldung("Der Holz-Bauplaner konnte nicht gestartet werden (kein freier Port).")
		return
	}
	go http.Serve(listener, http.FileServer(http.FS(web)))
	adresse := "http://" + listener.Addr().String() + "/"

	datenpfad := filepath.Join(os.Getenv("APPDATA"), "Holz-Bauplaner")
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		AutoFocus: true,
		DataPath:  datenpfad,
		WindowOptions: webview2.WindowOptions{
			Title:  "Holz-Bauplaner",
			Width:  uint(1280 * skala),
			Height: uint(860 * skala),
			Center: true,
		},
	})
	if w == nil {
		// WebView2 fehlt: App im Standardbrowser öffnen und weiter ausliefern
		meldung("Microsoft Edge WebView2 wurde nicht gefunden. Der Holz-Bauplaner öffnet sich deshalb in deinem Browser.\n\nZum Beenden das Programm im Task-Manager schließen.\nWebView2 gibt es kostenlos unter: https://go.microsoft.com/fwlink/p/?LinkId=2124703")
		oeffnen(adresse)
		select {}
	}
	defer w.Destroy()
	w.Bind("extern", func(url string) {
		if strings.HasPrefix(url, "http://") || strings.HasPrefix(url, "https://") {
			oeffnen(url)
		}
	})
	w.Init(initSkript)
	w.Navigate(adresse)
	w.Run()
}

func lauschen() net.Listener {
	for _, p := range ports {
		if l, err := net.Listen("tcp", "127.0.0.1:"+p); err == nil {
			return l
		}
	}
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil
	}
	return l
}

func oeffnen(url string) {
	cmd := exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	_ = cmd.Start()
}

func meldung(text string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	titel, _ := syscall.UTF16PtrFromString("Holz-Bauplaner")
	inhalt, _ := syscall.UTF16PtrFromString(text)
	user32.NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(inhalt)), uintptr(unsafe.Pointer(titel)), 0x40)
}

// Schaltet scharfe Darstellung auf hochauflösenden Bildschirmen ein (Per-Monitor-DPI v2)
// und liefert den Skalierungsfaktor für die Fenstergröße. Fehlt die Funktion (altes
// Windows), bleibt alles beim Standard.
func dpiAktivieren() float64 {
	user32 := syscall.NewLazyDLL("user32.dll")
	setzen := user32.NewProc("SetProcessDpiAwarenessContext")
	if setzen.Find() != nil {
		return 1
	}
	setzen.Call(^uintptr(3)) // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
	abfragen := user32.NewProc("GetDpiForSystem")
	if abfragen.Find() != nil {
		return 1
	}
	dpi, _, _ := abfragen.Call()
	if dpi < 96 {
		return 1
	}
	return float64(dpi) / 96
}
