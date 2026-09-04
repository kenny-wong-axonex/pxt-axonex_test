enum ApiCommand {
    //% block="Get Status"
    GetStatus,
    //% block="Set Sensor Mode"
    SetSensorMode,
    //% block="Reset Board"
    ResetBoard
}
namespace R300ApiTx {
    for (let i = 0; i < 5; i++) {
        serial.writeLine("test123");
        
        led.toggle(0, 0)
        basic.pause(500)
    }

    let pendingReqId = -1;
    let ackReceived = false;
    let listenerInitialized = false;

    /**
     * Initializes the UART listener to process incoming ACK packets.
     * Expected ACK format: {"ack": timestamp, "status": "ok"}
     */
    function initAckListener() {
        if (listenerInitialized) return;
        listenerInitialized = true;

        serial.onDataReceived(serial.delimiters(Delimiters.NewLine), () => {
            let line = serial.readLine();
            try {
                let msg = JSON.parse(line);
                if (msg && msg.ack === pendingReqId) {
                    ackReceived = true;
                }
            } catch (e) {
                // Ignore malformed or non-JSON serial input
            }
        });
    }

    /**
     * Calculates a simple 16-bit Fletcher checksum for a string.
     */
    function calculateChecksum(data: string): number {
        let sum1 = 0;
        let sum2 = 0;
        for (let j = 0; j < data.length; j++) {
            sum1 = (sum1 + data.charCodeAt(j)) % 255;
            sum2 = (sum2 + sum1) % 255;
        }
        return (sum2 << 8) | sum1;
    }

    /**
     * Send standardized API payload over UART with ACK wait & retry logic.
     * Shows LED status indicators on success (Checkmark) or failure (X for 5s).
     * @param cmd API Command to execute
     * @param maxRetries Maximum retry attempts (default 3)
     * @param timeoutMs Timeout in ms per attempt (default 500ms)
     */
    //% block="send API command %cmd over UART"
    //% cmd.fieldEditor="gridpicker"
    //% cmd.fieldOptions.columns=3
    export function sendApiPayload(cmd: ApiCommand, maxRetries: number = 3, timeoutMs: number = 500): void {
        initAckListener();

        let actionStr = "";
        let actionData: any = {};
        let ts = input.runningTime(); // Timestamp serves as the unique request ID

        switch (cmd) {
            case ApiCommand.GetStatus:
                actionStr = "getStatus";
                actionData = { reqId: ts };
                break;
            case ApiCommand.SetSensorMode:
                actionStr = "setMode";
                actionData = { reqId: ts, mode: "active", rate: 500 };
                break;
            case ApiCommand.ResetBoard:
                actionStr = "reset";
                actionData = { reqId: ts, hard: true };
                break;
        }

        let payload = {
            ts: ts,
            action: actionStr,
            data: actionData
        };

        let jsonString = JSON.stringify(payload);
        let chk = calculateChecksum(jsonString);

        let framedMessage = JSON.stringify({
            raw: jsonString,
            chk: chk
        });

        // Retry loop
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            pendingReqId = ts;
            ackReceived = false;

            serial.writeLine(framedMessage);

            // Wait for ACK or timeout
            let startTime = input.runningTime();
            while (input.runningTime() - startTime < timeoutMs) {
                if (ackReceived) {
                    pendingReqId = -1;

                    // Debug Visual: Brief checkmark for success
                    basic.showIcon(IconNames.Yes);
                    basic.pause(300);
                    basic.clearScreen();

                    return;
                }
                basic.pause(20); // Yield to MakeCode event queue
            }
        }

        // Execution failed after all retry attempts
        pendingReqId = -1;

        // Debug Visual: Show 'X' for 5 seconds on failure
        basic.showIcon(IconNames.No);
        basic.pause(5000);
        basic.clearScreen();

        // return false;
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

    const CONTROL_MOTOR_TIMEOUT_MS = 500    // ack-wait bound. Independent of `time` — R300
    // acks BEFORE running the move, so this only
    // has to cover round-trip latency.
    const CONTROL_MOTOR_MAX_TIME_MS = 3000  // must match R300's kControlMotorMaxTimeMs

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
                })
            }
        }

        /**
         * Send a text message to R300, wrapped as JSON with a checksum.
         */
        //% blockId=r300_send_message
        //% block="%this|send message %text to R300"
        //% weight=90
        sendMessage(text: string): void {
            serial.writeString(JSON.stringify({ MicroBit: text, checksum: checksum(text) }) + "\n")
        }

        /**
         * Move R300's chassis: rotation/forward are percent (-100..100), time is ms
         * (0..3000). Returns whether R300 accepted the command — NOT whether the move
         * has finished, since R300 acks before it moves. Safe to call as a bare
         * statement if you don't care about the result.
         */
        //% blockId=r300_control_motor
        //% block="%this|move rotation %rotation forward %forward for %time ms"
        //% rotation.min=-100 rotation.max=100
        //% forward.min=-100 forward.max=100
        //% weight=80
        controlMotor(rotation: number, forward: number, time: number): boolean {
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

            if (controlMotorAckStatus == "") return false            // link hiccup — give up
            if (controlMotorAckChecksum != expected) return false    // stale ack from an earlier call
            return controlMotorAckStatus == "success"
        }
    }

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

    /**
     * Connect to R300 over the P0/P1 UART link.
     */
    //% blockId=r300_connect
    //% block="connect to R300"
    //% weight=100
    //% blockSetVariable=r300Link
    export function connect(): R300Link {
        return new R300Link()
    }
}

let r300Link = r300.connect()

// Random gap between hello messages — just a liveness heartbeat now (see R300's
// passive silence-timeout watch), no reply expected.
const MIN_GAP_MS = 1000
const MAX_GAP_MS = 5000

basic.forever(function () {
    r300Link.sendMessage("Hello World!")
    basic.pause(Math.randomRange(MIN_GAP_MS, MAX_GAP_MS))
})
