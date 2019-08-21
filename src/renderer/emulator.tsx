import * as React from "react";
import * as fs from "fs-extra";
import * as path from "path";
import { ipcRenderer, remote, shell } from "electron";

import { CONSTANTS, IPC_COMMANDS } from "../constants";
import { getDiskImageSize } from "../utils/disk-image-size";
import { CardStart } from "./card-start";
import { StartMenu } from "./start-menu";
import { CardFloppy } from "./card-floppy";
import { CardState } from "./card-state";
import { EmulatorInfo } from "./emulator-info";

export interface EmulatorState {
  currentUiCard: string;
  emulator?: any;
  floppyFile?: string;
  isBootingFresh: boolean;
  isCursorCaptured: boolean;
  isInfoDisplayed: boolean;
  isRunning: boolean;
}

export class Emulator extends React.Component<{}, EmulatorState> {
  private isQuitting = false;
  private isResetting = false;

  constructor(props: {}) {
    super(props);

    this.startEmulator = this.startEmulator.bind(this);
    this.stopEmulator = this.stopEmulator.bind(this);
    this.restartEmulator = this.restartEmulator.bind(this);
    this.resetEmulator = this.resetEmulator.bind(this);

    this.state = {
      isBootingFresh: false,
      isCursorCaptured: false,
      isRunning: false,
      currentUiCard: "start",
      isInfoDisplayed: true
    };

    this.setupInputListeners();
    this.setupIpcListeners();
    this.setupUnloadListeners();

    if (document.location.hash.includes("AUTO_START")) {
      this.startEmulator();
    }
  }

  /**
   * We want to capture and release the mouse at appropriate times.
   */
  public setupInputListeners() {
    // ESC
    document.onkeydown = evt => {
      const { isCursorCaptured } = this.state;

      evt = evt || window.event;

      if (evt.keyCode === 27) {
        if (isCursorCaptured) {
          this.unlockMouse();
        } else {
          this.lockMouse();
        }
      }
    };

    // Click
    document.addEventListener("click", () => {
      const { isRunning } = this.state;

      if (isRunning) {
        this.lockMouse();
      }
    });
  }

  /**
   * Save the emulator's state to disk during exit.
   */
  public setupUnloadListeners() {
    const handleClose = async () => {
      await this.saveState();
      this.isQuitting = true;
      remote.app.quit();
    };

    window.onbeforeunload = event => {
      if (this.isQuitting) return;
      if (this.isResetting) return;

      handleClose();
      event.preventDefault();
      event.returnValue = false;
    };
  }

  /**
   * Setup the various IPC messages sent to the renderer
   * from the main process
   */
  public setupIpcListeners() {
    ipcRenderer.on(IPC_COMMANDS.MACHINE_CTRL_ALT_DEL, () => {
      if (this.state.emulator && this.state.isRunning) {
        this.state.emulator.keyboard_send_scancodes([
          0x1d, // ctrl
          0x38, // alt
          0x53, // delete

          // break codes
          0x1d | 0x80,
          0x38 | 0x80,
          0x53 | 0x80
        ]);
      }
    });

    ipcRenderer.on(IPC_COMMANDS.MACHINE_ALT_F4, () => {
      if (this.state.emulator && this.state.isRunning) {
        this.state.emulator.keyboard_send_scancodes([
          0x38, // alt
          0x3E, // f4

          // break codes
          0x38 | 0x80,
          0x3E | 0x80
        ]);
      }
    });

    ipcRenderer.on(IPC_COMMANDS.MACHINE_ALT_ENTER, () => {
      if (this.state.emulator && this.state.isRunning) {
        this.state.emulator.keyboard_send_scancodes([
          0x38, // alt
          0, // enter

          // break codes
          0x38 | 0x80,
          0 | 0x80
        ]);
      }
    });

    ipcRenderer.on(IPC_COMMANDS.MACHINE_STOP, this.stopEmulator);
    ipcRenderer.on(IPC_COMMANDS.MACHINE_RESET, this.resetEmulator);
    ipcRenderer.on(IPC_COMMANDS.MACHINE_START, this.startEmulator);
    ipcRenderer.on(IPC_COMMANDS.MACHINE_RESTART, this.restartEmulator);

    ipcRenderer.on(IPC_COMMANDS.TOGGLE_INFO, () => {
      this.setState({ isInfoDisplayed: !this.state.isInfoDisplayed });
    });

    ipcRenderer.on(IPC_COMMANDS.SHOW_DISK_IMAGE, () => {
      this.showDiskImage();
    });
  }

  /**
   * If the emulator isn't running, this is rendering the, erm, UI.
   *
   * 🤡
   */
  public renderUI() {
    const { isRunning, currentUiCard } = this.state;

    if (isRunning) {
      return null;
    }

    let card;

    if (currentUiCard === "floppy") {
      card = (
        <CardFloppy
          setFloppyPath={floppyFile => this.setState({ floppyFile })}
          floppyPath={this.state.floppyFile}
        />
      );
    } else if (currentUiCard === "state") {
      card = <CardState bootFromScratch={this.bootFromScratch} />;
    } else {
      card = <CardStart startEmulator={this.startEmulator} />;
    }

    return (
      <>
        {card}
        <StartMenu
          navigate={target => this.setState({ currentUiCard: target })}
        />
      </>
    );
  }

  /**
   * Yaknow, render things and stuff.
   */
  public render() {
    return (
      <>
        <EmulatorInfo
          emulator={this.state.emulator}
          toggleInfo={() => {
            this.setState({ isInfoDisplayed: !this.state.isInfoDisplayed });
          }}
        />
        {this.renderUI()}
        <div id="emulator">
          <div></div>
          <canvas></canvas>
        </div>
      </>
    );
  }

  /**
   * Boot the emulator without restoring state
   */
  public bootFromScratch() {
    this.setState({ isBootingFresh: true });
    this.startEmulator();
  }

  /**
   * Show the disk image on disk
   */
  public showDiskImage() {
    const imagePath = path
      .join(__dirname, "images/windows95.img")
      .replace("app.asar", "app.asar.unpacked");

    shell.showItemInFolder(imagePath);
  }

  /**
   * Start the actual emulator
   */
  private async startEmulator() {
    document.body.classList.remove("paused");

    const imageSize = await getDiskImageSize();
    const options = {
      memory_size: 128 * 1024 * 1024,
      video_memory_size: 32 * 1024 * 1024,
      screen_container: document.getElementById("emulator"),
      bios: {
        url: "../../bios/seabios.bin"
      },
      vga_bios: {
        url: "../../bios/vgabios.bin"
      },
      hda: {
        url: "../../images/windows95.img",
        async: true,
        size: imageSize
      },
      fda: {
        buffer: this.state.floppyFile
      },
      boot_order: 0x132
    };

    console.log(`🚜 Starting emulator with options`, options);

    window["emulator"] = new V86Starter(options);

    // New v86 instance
    this.setState({
      emulator: window["emulator"],
      isRunning: true
    });

    ipcRenderer.send(IPC_COMMANDS.MACHINE_STARTED);

    // Restore state. We can't do this right away
    // and randomly chose 500ms as the appropriate
    // wait time (lol)
    setTimeout(async () => {
      if (!this.state.isBootingFresh) {
        this.restoreState();
      }

      this.lockMouse();
      this.state.emulator.run();
    }, 500);
  }

  /**
   * Restart emulator
   */
  private restartEmulator() {
    if (this.state.emulator && this.state.isRunning) {
      console.log(`🚜 Restarting emulator`);
      this.state.emulator.restart();
    } else {
      console.log(`🚜 Restarting emulator failed: Emulator not running`);
    }
  }

  /**
   * Stop the emulator
   */
  private async stopEmulator() {
    const { emulator, isRunning } = this.state;

    if (!emulator || !isRunning) {
      return;
    }

    console.log(`🚜 Stopping emulator`);

    await this.saveState();
    this.unlockMouse();
    emulator.stop();
    this.setState({ isRunning: false });

    document.body.classList.add("paused");
    ipcRenderer.send(IPC_COMMANDS.MACHINE_STOPPED);
  }

  /**
   * Reset the emulator by reloading the whole page (lol)
   */
  private async resetEmulator() {
    this.isResetting = true;
    document.location.hash = `#AUTO_START`;
    document.location.reload();
  }

  /**
   * Take the emulators state and write it to disk. This is possibly
   * a fairly big file.
   */
  private async saveState(): Promise<void> {
    const { emulator } = this.state;

    if (!emulator || !emulator.save_state) {
      console.log(`restoreState: No emulator present`);
      return;
    }

    return new Promise(resolve => {
      emulator.save_state(async (error: Error, newState: ArrayBuffer) => {
        if (error) {
          console.warn(`saveState: Could not save state`, error);
          return;
        }

        await fs.outputFile(CONSTANTS.STATE_PATH, Buffer.from(newState));

        console.log(`saveState: Saved state to ${CONSTANTS.STATE_PATH}`);

        resolve();
      });
    });
  }

  /**
   * Restores state to the emulator.
   */
  private restoreState() {
    const { emulator } = this.state;
    const state = this.getState();

    // Nothing to do with if we don't have a state
    if (!state) {
      console.log(`restoreState: No state present, not restoring.`);
    }

    if (!emulator) {
      console.log(`restoreState: No emulator present`);
    }

    try {
      this.state.emulator.restore_state(state);
    } catch (error) {
      console.log(
        `State: Could not read state file. Maybe none exists?`,
        error
      );
    }
  }

  /**
   * Returns the current machine's state - either what
   * we have saved or alternatively the default state.
   *
   * @returns {ArrayBuffer}
   */
  private getState(): ArrayBuffer | null {
    const statePath = fs.existsSync(CONSTANTS.STATE_PATH)
      ? CONSTANTS.STATE_PATH
      : CONSTANTS.DEFAULT_STATE_PATH;

    if (fs.existsSync(statePath)) {
      return fs.readFileSync(statePath).buffer;
    }

    return null;
  }

  private unlockMouse() {
    const { emulator } = this.state;

    this.setState({ isCursorCaptured: false });

    if (emulator) {
      emulator.mouse_set_status(false);
    }

    document.exitPointerLock();
  }

  private lockMouse() {
    const { emulator } = this.state;

    if (emulator) {
      this.setState({ isCursorCaptured: true });
      emulator.mouse_set_status(true);
      emulator.lock_mouse();
    } else {
      console.warn(
        `Emulator: Tried to lock mouse, but no emulator or not running`
      );
    }
  }
}
