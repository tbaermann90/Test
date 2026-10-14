// Gehege 3D: startet einen kleinen lokalen Webserver und öffnet die
// 3D-Ansicht des Meerschweinchengeheges im Standardbrowser.
// Die Teile werden in "gehege.json" neben der Exe gespeichert.
package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
)

//go:embed web
var webFiles embed.FS

//go:embed default.json
var defaultLayout []byte

var fileMu sync.Mutex

func dataPath() string {
	exe, err := os.Executable()
	if err != nil {
		return "gehege.json"
	}
	return filepath.Join(filepath.Dir(exe), "gehege.json")
}

func handleLayout(w http.ResponseWriter, r *http.Request) {
	fileMu.Lock()
	defer fileMu.Unlock()
	path := dataPath()

	switch r.Method {
	case http.MethodGet:
		data, err := os.ReadFile(path)
		if err != nil {
			data = defaultLayout
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(data)
	case http.MethodPut:
		body, err := io.ReadAll(io.LimitReader(r.Body, 5<<20))
		if err != nil || !json.Valid(body) {
			http.Error(w, "ungültige Daten", http.StatusBadRequest)
			return
		}
		if err := os.WriteFile(path, body, 0o644); err != nil {
			http.Error(w, "Speichern fehlgeschlagen: "+err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	case http.MethodDelete:
		os.Remove(path)
		w.Header().Set("Content-Type", "application/json")
		w.Write(defaultLayout)
	default:
		http.Error(w, "nicht erlaubt", http.StatusMethodNotAllowed)
	}
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		fmt.Println("Browser konnte nicht automatisch geöffnet werden.")
	}
}

func main() {
	sub, err := fs.Sub(webFiles, "web")
	if err != nil {
		log.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.FS(sub)))
	mux.HandleFunc("/api/gehege", handleLayout)

	addr := "127.0.0.1:0"
	if p := os.Getenv("GEHEGE_PORT"); p != "" {
		addr = "127.0.0.1:" + p
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatal(err)
	}
	url := fmt.Sprintf("http://%s/", ln.Addr().String())

	fmt.Println("==============================================")
	fmt.Println("  Gehege 3D - Meerschweinchengehege-Planer")
	fmt.Println("==============================================")
	fmt.Println()
	fmt.Println("Die Ansicht öffnet sich jetzt im Browser:")
	fmt.Println("  " + url)
	fmt.Println()
	fmt.Println("Gespeichert wird in:")
	fmt.Println("  " + dataPath())
	fmt.Println()
	fmt.Println("Zum Beenden dieses Fenster schließen.")

	if os.Getenv("GEHEGE_NO_BROWSER") == "" {
		openBrowser(url)
	}
	log.Fatal(http.Serve(ln, mux))
}
