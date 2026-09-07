//% color="#AA278D" icon="\uf013" block="R300 Core"
namespace r300 {
    export class R300Link {
        private latestAck: string = "";
        private latestFinish: string = "";
        private listenerRegistered: boolean = false;

        constructor() {
            if (!input.buttonIsPressed(Button.A)) {
                serial.redirect(SerialPin.P0, SerialPin.P1, BaudRate.BaudRate115200);
            }

            if (!this.listenerRegistered) {
                this.listenerRegistered = true;
                serial.onDataReceived(serial.delimiters(Delimiters.NewLine), () => {
                    const line = serial.readLine().trim();
                    if (line.includes("_ack")) {
                        this.latestAck = line;
                    } else if (line.includes("_finish")) {
                        this.latestFinish = line;
                    } else {
                        r300_api.dispatchApi(line);
                    }
                });
            }

            this.startKeepAlive();
        }

        public executeCommand(deviceName: string, payload: string, errorCode: number, executeTimeoutMs: number = 2000): boolean {
            this.latestAck = "";
            this.latestFinish = "";
            let ackReceived = false;

            for (let attempt = 0; attempt < 3; attempt++) {
                serial.writeLine(payload);

                let ackStartTime = control.millis();
                while (control.millis() - ackStartTime < 500) {
                    if (this.latestAck.includes(deviceName)) {
                        ackReceived = true;
                        break;
                    }
                    basic.pause(10);
                }

                if (ackReceived) {
                    break;
                }
            }

            if (!ackReceived || !this.latestAck.includes("success")) {
                this.showError(errorCode);
                return false;
            }

            let finishStartTime = control.millis();
            while (!this.latestFinish.includes(deviceName) && control.millis() - finishStartTime < executeTimeoutMs) {
                basic.pause(10);
            }

            const success = this.latestFinish.includes("success");
            if (!success) {
                this.showError(errorCode);
            }
            return success;
        }

        private showError(code: number): void {
            basic.showNumber(code);
            basic.pause(1000);
            basic.clearScreen();
        }

        private sendMessage(text: string): void {
            serial.writeString(JSON.stringify({ MicroBit: text, checksum: checksum(text) }) + "\n");
        }

        private startKeepAlive(): void {
            const MIN_GAP_MS = 1000;
            const MAX_GAP_MS = 5000;
            control.inBackground(function () {
                while (true) {
                    link.sendMessage("Hello World!");
                    basic.pause(Math.randomRange(MIN_GAP_MS, MAX_GAP_MS));
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
namespace r300_movement {
    const CONTROL_MOTOR_MAX_TIME_MS = 5000;

    export function controlMotor(rotation: number, forward: number, time: number): void {
        rotation = clamp(Math.round(rotation), -100, 100);
        forward = clamp(Math.round(forward), -100, 100);
        time = clamp(Math.round(time), 0, CONTROL_MOTOR_MAX_TIME_MS);

        const canonical = "" + rotation + "," + forward + "," + time;
        const expected = checksum(canonical);

        const payload = JSON.stringify({
            cmd: "control_motor",
            rotation: rotation,
            forward: forward,
            time: time,
            checksum: expected
        });

        r300.link.executeCommand("control_motor", payload, 1, time + 2000);
    }

    //% block="drive %dir for %time seconds"
    //% time.defl=1
    //% weight=90
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
    export function turn(dir: TurnDirection): void {
        if (dir === TurnDirection.Left) {
            controlMotor(-25, 0, 1000);
        } else {
            controlMotor(25, 0, 1000);
        }
    }
}

//% color="#E67E22" icon="\uf256" block="R300 Hands"
namespace r300_hands {
    export function controlServo(angle_1: number, angle_2: number, time: number): void {
        angle_1 = clamp(Math.round(angle_1), -1, 100);
        angle_2 = clamp(Math.round(angle_2), -1, 100);
        time = -1;

        const canonical = "" + angle_1 + "," + angle_2 + "," + time;
        const expected = checksum(canonical);

        const payload = JSON.stringify({
            cmd: "control_servo",
            a1: angle_1,
            a2: angle_2,
            time: time,
            checksum: expected
        });

        r300.link.executeCommand("control_servo", payload, 2, 2000);
    }

    //% block="move left hand to %pos"
    export function leftHand(pos: HandPosition): void {
        controlServo(pos, -1, -1);
    }

    //% block="move right hand to %pos"
    export function rightHand(pos: HandPosition): void {
        controlServo(-1, pos, -1);
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
namespace r300_emotion {
    //% block="show emotion %face"
    export function showEmotion(face: RobotEmotion): void {
        const payload = JSON.stringify({
            cmd: "set_emotion",
            emotion: face
        });
        serial.writeLine(payload);
    }
}

//% color="#E67E22" icon="\uf028" block="R300 Speaker"
namespace r300_speaker {
    //% block="speak text %text"
    export function speakText(text: string): void {
        const payload = JSON.stringify({
            cmd: "speak",
            message: text
        });
        serial.writeLine(payload);
    }
}

//% color="#E67E22" icon="\uf013" block="R300 Mode"
namespace r300_mode {
    //% block="set robot mode to %mode"
    export function setRobotMode(mode: RobotMode): void {
        const payload = JSON.stringify({
            cmd: "set_mode",
            mode: mode
        });
        serial.writeLine(payload);
    }

    //% block="bypass current mode with action %action"
    export function bypassMode(action: string): void {
        const payload = JSON.stringify({
            cmd: "bypass_mode",
            action: action
        });
        serial.writeLine(payload);
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
    Up = 100,
    //% block="down"
    Down = 50,
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