import { toggleInfo } from 'es6://info.js'

export function setupIpcListeners () {
  const { windows95 } = window

  windows95.addListener(windows95.IPC_COMMANDS.TOGGLE_INFO, () => {
    toggleInfo()
  })

  windows95.addListener(windows95.IPC_COMMANDS.MACHINE_RESTART, () => {
    if (!window.emulator || !window.emulator.is_running) return

    window.emulator.restart()
  })

  windows95.addListener(windows95.IPC_COMMANDS.MACHINE_CTRL_ALT_DEL, () => {
    if (!window.emulator || !window.emulator.is_running) return

    window.emulator.keyboard_send_scancodes([
      0x1D, // ctrl
      0x38, // alt
      0x53, // delete

      // break codes
      0x1D | 0x80,
      0x38 | 0x80,
      0x53 | 0x80
    ])
  })

  windows95.addListener(windows95.IPC_COMMANDS.SHOW_DISK_IMAGE, () => {
    windows95.showDiskImage()
  })
}
