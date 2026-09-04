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

namespace R300ApiTx {
    /**
     * Drive forward or backward for a set duration
     * @param time duration in seconds, eg: 1
     */
    //% block="drive %dir for %time s"
    //% time.min=0 time.max=5 time.defl=1
    //% weight=90
    export function drive(dir: MoveDirection, time: number = 1): void {
        let timeMs = time * 1000
        if (dir === MoveDirection.Forward) {
            r300.r300Link.controlMotor(0, 100, timeMs)
        } else {
            r300.r300Link.controlMotor(0, -100, timeMs)
        }
    }

    /**
     * Turn left or right (fixed 1 second)
     */
    //% block="turn %dir"
    //% weight=89
    export function turn(dir: TurnDirection): void {
        if (dir === TurnDirection.Left) {
            r300.r300Link.controlMotor(-25, 0, 1000)
        } else {
            r300.r300Link.controlMotor(25, 0, 1000)
        }
    }
}



//% color="#AA278D" icon="" block="R300"
namespace r300 {
    let listenerRegistered = false

    // Set by the shared onDataReceived handler when a control_motor ack line arrives.
    // Module-level, not per-call, because MakeCode's serial.onDataReceived is a single
    // global event handler — controlMotor() polls this instead of reading serial itself.
    let controlMotorAckStatus = ""       // "" = none yet, else "success" | "fail"
    let controlMotorAckChecksum = -1
    let controlServoAckStatus = ""       // "" = none yet, else "success" | "fail"
    let controlServoAckChecksum = -1

    const CONTROL_MOTOR_TIMEOUT_MS = 2000    // ack-wait bound. Independent of `time` — R300
    // acks BEFORE running the move, so this only
    // has to cover round-trip latency.
    const CONTROL_SERVO_TIMEOUT_MS = 2000    // servo

    const CONTROL_MOTOR_MAX_TIME_MS = 3000  // must match R300's kControlMotorMaxTimeMs
    const CONTROL_SERVO_MAX_TIME_MS = 3000  // servo

    export class R300Link {
        constructor() {
            // tx=P0 -> R300 GPIO21 (rx), rx=P1 <- R300 GPIO10 (tx).
            // Hold Button A while resetting to skip the redirect and stay on
            // USB serial instead, for debugging without a firmware reflash.
            if (!input.buttonIsPressed(Button.A)) {
                serial.redirect(SerialPin.P0, SerialPin.P1, BaudRate.BaudRate115200)
            }

            // Register only once — creating more than one R300Link must not
            // stack duplicate serial.onDataReceived handlers.
            if (!listenerRegistered) {
                listenerRegistered = true
                serial.onDataReceived(serial.delimiters(Delimiters.NewLine), function () {
                    const line = serial.readLine()
                    if (line.indexOf("control_motor_ack") >= 0) {
                        controlMotorAckStatus = line.indexOf("success") >= 0 ? "success" : "fail"
                        controlMotorAckChecksum = extractChecksum(line)
                    }
                    if (line.indexOf("control_servo_ack") >= 0) {
                        controlServoAckStatus = line.indexOf("success") >= 0 ? "success" : "fail"
                        controlServoAckChecksum = extractChecksum(line)
                    }
                })
            }
        }

        /**
         * Send a text message to R300, wrapped as JSON with a checksum.
         */
        sendMessage(text: string): void {
            serial.writeString(JSON.stringify({ MicroBit: text, checksum: checksum(text) }) + "\n")
        }

        /**
         * Move R300's chassis: rotation/forward are percent (-100..100), time is ms
         * (0..3000). Returns whether R300 accepted the command — NOT whether the move
         * has finished, since R300 acks before it moves. Safe to call as a bare
         * statement if you don't care about the result.
         */
        controlMotor(rotation: number, forward: number, time: number): void {
            rotation = clamp(Math.round(rotation), -100, 100)
            forward = clamp(Math.round(forward), -100, 100)
            time = clamp(Math.round(time), 0, CONTROL_MOTOR_MAX_TIME_MS)

            const canonical = "" + rotation + "," + forward + "," + time
            const expected = checksum(canonical)
            controlMotorAckStatus = ""
            controlMotorAckChecksum = -1

            serial.writeString(JSON.stringify({
                cmd: "control_motor", rotation: rotation, forward: forward, time: time, checksum: expected
            }) + "\n")

            let waited = 0
            while (controlMotorAckStatus == "" && waited < CONTROL_MOTOR_TIMEOUT_MS) {
                basic.pause(20)
                waited += 20
            }

            if (controlMotorAckStatus == "") return             // link hiccup — give up
            if (controlMotorAckChecksum != expected) return     // stale ack from an earlier call
            // return controlMotorAckStatus == "success"
        }

        controlServo(angle_1: number, angle_2: number, time: number): void {
            angle_1 = clamp(Math.round(angle_1), -1, 100)
            angle_2 = clamp(Math.round(angle_2), -1, 100)
            time = clamp(Math.round(time), -1, CONTROL_SERVO_MAX_TIME_MS)

            const canonical = "" + angle_1 + "," + angle_2 + "," + time
            const expected = checksum(canonical)
            controlServoAckStatus = ""
            controlServoAckChecksum = -1

            serial.writeString(JSON.stringify({
                cmd: "control_servo", a1: angle_1, a2: angle_2, time: time, checksum: expected
            }) + "\n")

            let waited = 0
            while (controlServoAckStatus == "" && waited < CONTROL_SERVO_TIMEOUT_MS) {
                basic.pause(20)
                waited += 20
            }

            if (controlServoAckStatus == "") return             // link hiccup — give up
            if (controlServoAckChecksum != expected) return     // stale ack from an earlier call
            // return controlMotorAckStatus == "success"
        }
    }

    //////////////////
    function checksum(text: string): number {
        // Sum of char codes mod 256 — matches R300's Checksum256() for
        // ASCII text (aimo_v1_edu_microbit_board.cc).
        let sum = 0
        for (let i = 0; i < text.length; i++) {
            sum += text.charCodeAt(i)
        }
        return sum % 256
    }

    function clamp(v: number, lo: number, hi: number): number {
        return Math.max(lo, Math.min(hi, v))
    }

    function extractChecksum(line: string): number {
        // Textual scan, not JSON.parse — a corrupted line (a real, observed occurrence
        // on this link) may not even parse; this degrades gracefully instead of throwing.
        const idx = line.indexOf("\"checksum\":")
        if (idx < 0) return -1
        let start = idx + 11
        let end = start
        while (end < line.length && line.charCodeAt(end) >= 48 && line.charCodeAt(end) <= 57) {
            end++
        }
        if (end == start) return -1
        return parseInt(line.substr(start, end - start))
    }
    /////////////////////


    export let r300Link = new R300Link();

    const MIN_GAP_MS = 1000
    const MAX_GAP_MS = 5000
    basic.forever(function () {
        r300Link.sendMessage("Hello World!")
        basic.pause(Math.randomRange(MIN_GAP_MS, MAX_GAP_MS))
    })


}



// Random gap between hello messages — just a liveness heartbeat now (see R300's
// passive silence-timeout watch), no reply expected.
