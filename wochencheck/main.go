// Wochencheck zeigt in einem Fenster an, ob die aktuelle Kalenderwoche
// (ISO 8601, wie in Deutschland üblich) gerade oder ungerade ist.
package main

import (
	"fmt"
	"syscall"
	"time"
	"unsafe"
)

const (
	mbOK              = 0x00000000
	mbIconInformation = 0x00000040
)

func main() {
	jahr, woche := time.Now().ISOWeek()

	art := "ungerade"
	if woche%2 == 0 {
		art = "gerade"
	}

	text := fmt.Sprintf("Heute ist %s.\n\nKalenderwoche %d (%d)\n\nDas ist eine %s Woche.",
		time.Now().Format("02.01.2006"), woche, jahr, art)
	titel := fmt.Sprintf("KW %d – %s Woche", woche, art)

	zeigeFenster(titel, text)
}

func zeigeFenster(titel, text string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	messageBox := user32.NewProc("MessageBoxW")

	t, _ := syscall.UTF16PtrFromString(titel)
	m, _ := syscall.UTF16PtrFromString(text)
	messageBox.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), mbOK|mbIconInformation)
}
