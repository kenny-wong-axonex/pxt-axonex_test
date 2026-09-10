// ── Boot log ────────────────────────────────────────────────
// 等 USB CDC ready 先 print，避免開機頭幾個字被食
basic.pause(300);
serial.setRxBufferSize(128);
serial.writeLine("Hello World!");

// ── TX helper ───────────────────────────────────────────────
// 同時 send 去 UART（R300）＋ 印去 USB log（terminal 睇到）
function sendBoth(msg: string): void {
    const data = msg;                          // 先把要 send 嘅 data 放入 string
    console.log("[TX] " + data);               // → USB log
    serial.writeLine(data);                    // → UART P0/P1（R300 收到）
}

// ── TEMP TEST（測試用，測試完刪走） ─────────────────────────
// 撳 Button A → 雙手 180 → 雙手 90
input.onButtonPressed(Button.A, function () {
    console.log("[BTN] Button A pressed");   // ← confirm 個掣有 trigger
    r300_hands.bothHands(180, 180);
    basic.pause(500);                        // ← 0.5s 分隔，避免連續寫撞 log
    r300_hands.bothHands(90, 90);
    console.log("[BTN] done");
});

//% color="#AA278D" icon="\uf013" block="R300 Core"
namespace r300 {
    export class R300Link {
        private latestAck: string = "";
        private ackReceived: boolean = false;
        private ackSuccess: boolean = false;
        private expectedAckDevice: string = "";
        private latestFinish: string = "";
        private latestStatus: string = "";
        private latestLeftHand: string = "";
        private latestRightHand: string = "";
        private latestEmotion: string = "";
        private latestVolume: string = "";
        private listenerRegistered: boolean = false;

        constructor() {
        }

        private ensureInitialized(): void {
            if (this.listenerRegistered) {
                return;
            }

            if (!input.buttonIsPressed(Button.B)) {
                serial.redirect(SerialPin.P0, SerialPin.P1, BaudRate.BaudRate115200);
            }

            this.listenerRegistered = true;
            serial.onDataReceived(serial.delimiters(Delimiters.NewLine), () => {
                const line = serial.readLine().trim();
                // basic.showString(line);
                console.log("[RX] " + line);   // ← 收到嘅嘢都印去 USB log
                if (line.includes("_ack")) {
                    if (this.expectedAckDevice != "" && line.includes(this.expectedAckDevice)) {
                        this.latestAck = line;
                        this.ackReceived = true;
                        this.ackSuccess = line.includes("success");
                    }
                } else if (line.includes("_finish")) {
                    this.latestFinish = line;
                } else {
                    try {
                        // led.toggle(0, 0);
                        const parsed = JSON.parse(line);
                        // const parsed = JSON.parse("{\"cmd\": \"set_control_servo_ack\", \"status\": \"success\"}");
                        // led.toggle(1, 0);
                        if (parsed.MB_cmd === "system_status" && parsed.status !== undefined) {
                            this.latestStatus = "" + parsed.status;
                        } else if (parsed.MB_cmd === "servo_status") {
                            if (parsed.a1 !== undefined) {
                                this.latestLeftHand = "" + parsed.a1;
                            }
                            if (parsed.a2 !== undefined) {
                                this.latestRightHand = "" + parsed.a2;
                            }
                        } else if (parsed.MB_cmd === "emotion_status" && parsed.emotion !== undefined) {
                            this.latestEmotion = "" + parsed.emotion;
                        } else if (parsed.MB_cmd === "volume_status" && parsed.volume !== undefined) {
                            this.latestVolume = "" + parsed.volume;
                        }
                    } catch (e) {
                        led.toggle(2, 0);
                    }
                }
            });

            this.startKeepAlive();
        }

        public executeCommand(deviceName: string, payload: string, errorCode: number, executeTimeoutMs: number = 2000): boolean {
            this.ensureInitialized();
            this.latestAck = "";
            this.ackReceived = false;
            this.ackSuccess = false;
            this.expectedAckDevice = deviceName;
            this.latestFinish = "";
            const ackTimeoutMs = 500;
            const maxAttempts = 3;

            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                this.ackReceived = false;
                this.ackSuccess = false;
                this.latestAck = "";
                sendBoth(payload);

                let ackStartTime = control.millis();
                while (control.millis() - ackStartTime < ackTimeoutMs) {
                    if (this.ackReceived && this.latestAck.includes(deviceName)) {
                        break;
                    }
                    basic.pause(10);
                }

                if (this.ackReceived && this.latestAck.includes(deviceName) && this.ackSuccess) {
                    break;
                }
            }

            if (!(this.ackReceived && this.latestAck.includes(deviceName) && this.ackSuccess)) {
                // ACK timeout: report the error, then return so the next block can run.
                this.showError(errorCode);
                this.expectedAckDevice = "";
                return false;
            }

            // Finish checking logic commented out for bypass
            /*
            let finishSuccess = false;
            let finishStartTime = control.millis();
            while (control.millis() - finishStartTime < executeTimeoutMs) {
                if (this.latestFinish.includes(deviceName)) {
                    if (this.latestFinish.includes("success")) {
                        finishSuccess = true;
                    }
                    break;
                }
                basic.pause(10);
            }

            if (!finishSuccess) {
                this.showError(errorCode);
                return false;
            }
            */

            this.expectedAckDevice = "";
            return true;
        }

        public requestStatus(): string {
            this.ensureInitialized();
            this.latestStatus = "";
            const payload = JSON.stringify({ MB_cmd: "get_status" });
            sendBoth(payload);

            let startTime = control.millis();
            while (this.latestStatus == "" && control.millis() - startTime < 2000) {
                basic.pause(10);
            }
            return this.latestStatus;
        }

        public requestServoStatus(): void {
            this.ensureInitialized();
            this.latestLeftHand = "";
            this.latestRightHand = "";
            const payload = JSON.stringify({ MB_cmd: "get_servo" });
            sendBoth(payload);

            let startTime = control.millis();
            while ((this.latestLeftHand == "" || this.latestRightHand == "") && control.millis() - startTime < 2000) {
                basic.pause(10);
            }
        }

        public requestLeftHand(): string {
            this.requestServoStatus();
            return this.latestLeftHand;
        }

        public requestRightHand(): string {
            this.requestServoStatus();
            return this.latestRightHand;
        }

        public requestEmotion(): string {
            this.ensureInitialized();
            this.latestEmotion = "";
            const payload = JSON.stringify({ MB_cmd: "get_emotion" });
            sendBoth(payload);

            let startTime = control.millis();
            while (this.latestEmotion == "" && control.millis() - startTime < 2000) {
                basic.pause(10);
            }
            return this.latestEmotion;
        }

        public requestVolume(): string {
            this.ensureInitialized();
            this.latestVolume = "";
            const payload = JSON.stringify({ MB_cmd: "get_volume" });
            sendBoth(payload);

            let startTime = control.millis();
            while (this.latestVolume == "" && control.millis() - startTime < 2000) {
                basic.pause(10);
            }
            return this.latestVolume;
        }

        private showError(code: number): void {
            basic.showNumber(code);
            basic.pause(1000);
            basic.clearScreen();
        }

        private sendMessage(text: string): void {
            sendBoth(JSON.stringify({ MicroBit: text, checksum: checksum(text) }));
        }

        private startKeepAlive(): void {
            const MIN_GAP_MS = 1000;
            const MAX_GAP_MS = 5000;
            control.inBackground(function () {
                while (true) {
                    basic.pause(Math.randomRange(MIN_GAP_MS, MAX_GAP_MS));   // 先等，避免同第一個 command 撞
                    link.sendMessage("Hello World!");
                }
            });
        }
    }

    export const link = new R300Link();
}

function clamp(val: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, val));
}

function checksum(text: string): number {
    let sum = 0;
    for (let i = 0; i < text.length; i++) {
        sum += text.charCodeAt(i);
    }
    return sum % 256;
}

//% color="#E67E22" icon="\uf085" block="R300 Movement"
//% groups="['Drive Control', 'Turn Control', 'Custom Control', 'Status Inquiry']"
namespace r300_movement {
    const CONTROL_MOTOR_MAX_TIME_MS = 5000;

    export function controlMotor(rotation: number, forward: number, time: number): void {
        rotation = clamp(Math.round(rotation), -100, 100);
        forward = clamp(Math.round(forward), -100, 100);
        time = clamp(Math.round(time), 0, CONTROL_MOTOR_MAX_TIME_MS);

        const canonical = "" + rotation + "," + forward + "," + time;
        const expected = checksum(canonical);

        const payload = JSON.stringify({
            MB_cmd: "set_control_motor",
            rotation: rotation,
            forward: forward,
            time: time,
            checksum: expected
        });

        r300.link.executeCommand("set_control_motor", payload, 1, time + 2000);
    }

    //% block="drive %dir for %time seconds"
    //% time.defl=1
    //% weight=90
    //% group="Drive Control"
    export function drive(dir: MoveDirection, time: number = 1): void {
        let timeMs = time * 1000;
        if (dir === MoveDirection.Forward) {
            controlMotor(0, 100, timeMs);
        } else {
            controlMotor(0, -100, timeMs);
        }
    }

    //% block="turn %dir"
    //% weight=89
    //% group="Turn Control"
    export function turn(dir: TurnDirection): void {
        if (dir === TurnDirection.Left) {
            controlMotor(-25, 0, 1000);
        } else {
            controlMotor(25, 0, 1000);
        }
    }

    //% block="custom motor rotation %rotation forward %forward for %time ms"
    //% rotation.min=-100 rotation.max=100
    //% forward.min=-100 forward.max=100
    //% time.min=0 time.max=5000 time.defl=1000
    //% weight=88
    //% group="Custom Control"
    export function customMotor(rotation: number, forward: number, time: number): void {
        controlMotor(rotation, forward, time);
    }
}

//% color="#E67E22" icon="\uf256" block="R300 Hands"
//% groups="['Hand Control', 'Hand Status']"
namespace r300_hands {
    export function controlServo(angle_1: number, angle_2: number, time: number): void {
        angle_1 = clamp(Math.round(angle_1), -1, 180);
        angle_2 = clamp(Math.round(angle_2), -1, 180);
        time = -1;

        const canonical = "" + angle_1 + "," + angle_2 + "," + time;
        const expected = checksum(canonical);

        const payload = JSON.stringify({
            MB_cmd: "set_control_servo",
            a1: angle_1,
            a2: angle_2,
            time: time,
            checksum: expected
        });

        r300.link.executeCommand("set_control_servo", payload, 2, 2000);
    }

    //% block="move left hand to %pos"
    //% pos.min=-1 pos.max=180
    //% group="Hand Control"
    export function leftHand(pos: HandPosition): void {
        controlServo(pos, -1, -1);
    }

    //% block="move right hand to %pos"
    //% pos.min=-1 pos.max=180
    //% group="Hand Control"
    export function rightHand(pos: HandPosition): void {
        controlServo(-1, pos, -1);
    }

    //% block="move both hands left %a1 right %a2"
    //% a1.min=-1 a1.max=180
    //% a2.min=-1 a2.max=180
    //% group="Hand Control"
    export function bothHands(a1: number, a2: number): void {
        controlServo(a1, a2, -1);
    }

    //% block="get left hand position"
    //% group="Hand Status"
    export function getLeftHand(): string {
        return r300.link.requestLeftHand();
    }

    //% block="get right hand position"
    //% group="Hand Status"
    export function getRightHand(): string {
        return r300.link.requestRightHand();
    }
}

//% color="#E67E22" icon="\uf121" block="R300 API Events"
//% groups="['API Program 1', 'API Program 2', 'API Program 3', 'API Program 4', 'API Program 5']"
namespace r300_api {
    let api1Handler: () => void = null;
    let api2Handler: () => void = null;
    let api3Handler: () => void = null;
    let api4Handler: () => void = null;
    let api5Handler: () => void = null;

    export function dispatchApi(cmd: string): void {
        if (cmd.includes("cmd_api_1") && api1Handler) {
            control.inBackground(api1Handler);
        } else if (cmd.includes("cmd_api_2") && api2Handler) {
            control.inBackground(api2Handler);
        } else if (cmd.includes("cmd_api_3") && api3Handler) {
            control.inBackground(api3Handler);
        } else if (cmd.includes("cmd_api_4") && api4Handler) {
            control.inBackground(api4Handler);
        } else if (cmd.includes("cmd_api_5") && api5Handler) {
            control.inBackground(api5Handler);
        }
    }

    //% block="program 1"
    //% group="API Program 1"
    export function program1(handler: () => void): void {
        api1Handler = handler;
    }

    //% block="program 2"
    //% group="API Program 2"
    export function program2(handler: () => void): void {
        api2Handler = handler;
    }

    //% block="program 3"
    //% group="API Program 3"
    export function program3(handler: () => void): void {
        api3Handler = handler;
    }

    //% block="program 4"
    //% group="API Program 4"
    export function program4(handler: () => void): void {
        api4Handler = handler;
    }

    //% block="program 5"
    //% group="API Program 5"
    export function program5(handler: () => void): void {
        api5Handler = handler;
    }
}

//% color="#E67E22" icon="\uf118" block="R300 Emotion"
//% groups="['Emotion Control', 'Emotion Status']"
namespace r300_emotion {
    //% block="show emotion %face"
    //% group="Emotion Control"
    export function showEmotion(face: RobotEmotion): void {
        const payload = JSON.stringify({
            MB_cmd: "set_emotion",
            emotion: face
        });
        r300.link.executeCommand("set_emotion", payload, 3, 2000);
    }

    //% block="get current emotion"
    //% group="Emotion Status"
    export function getEmotion(): string {
        return r300.link.requestEmotion();
    }
}

//% color="#E67E22" icon="\uf028" block="R300 Speaker"
//% groups="['Audio Actions', 'Speaker Status']"
namespace r300_speaker {
    //% block="speak text %text"
    //% group="Audio Actions"
    export function speakText(text: string): void {
        const payload = JSON.stringify({
            MB_cmd: "set_speak",
            message: text
        });
        const timeoutMs = text.length * 100 + 2000;
        r300.link.executeCommand("set_speak", payload, 4, timeoutMs);
    }

    //% block="set speaker volume to %volume"
    //% volume.min=0 volume.max=100
    //% group="Audio Actions"
    export function setSpeakerVol(volume: number): void {
        volume = clamp(Math.round(volume), 0, 100);
        const payload = JSON.stringify({
            MB_cmd: "set_volume",
            volume: volume
        });
        r300.link.executeCommand("set_volume", payload, 5, 2000);
    }

    //% block="get speaker volume"
    //% group="Speaker Status"
    export function getSpeakerVol(): string {
        return r300.link.requestVolume();
    }
}

//% color="#E67E22" icon="\uf013" block="R300 Mode"
//% groups="['Configuration', 'System Status']"
namespace r300_mode {
    //% block="set robot mode to %mode"
    //% group="Configuration"
    export function setRobotMode(mode: RobotMode): void {
        const payload = JSON.stringify({
            MB_cmd: "set_mode",
            mode: mode
        });
        r300.link.executeCommand("set_mode", payload, 6, 2000);
    }

    //% block="bypass mode %bypass"
    //% group="Configuration"
    export function bypassMode(bypass: boolean): void {
        const payload = JSON.stringify({
            MB_cmd: "set_bypass_mode",
            bypass: bypass
        });
        r300.link.executeCommand("set_bypass_mode", payload, 7, 2000);
    }

    //% block="get robot status"
    //% group="System Status"
    export function getStatus(): string {
        return r300.link.requestStatus();
    }
}

enum MoveDirection {
    //% block="forward"
    Forward,
    //% block="backward"
    Backward
}

enum TurnDirection {
    //% block="left"
    Left,
    //% block="right"
    Right
}

enum HandPosition {
    //% block="up"
    Up = 180,
    //% block="down"
    Down = 90,
    //% block="back"
    Back = 0
}

enum RobotEmotion {
    //% block="happy"
    Happy = 1,
    //% block="sad"
    Sad = 2,
    //% block="angry"
    Angry = 3,
    //% block="surprised"
    Surprised = 4
}

enum RobotMode {
    //% block="active"
    Active = 1,
    //% block="idle"
    Idle = 2
}