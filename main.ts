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
namespace r300 {
    let listenerRegistered = false

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
                    const line2 = serial.readLine()
                    // Only answer R300's own ping — never its ack, or both
                    // sides would ping-pong each other until the link saturates.
                    if (line2.indexOf("R300_ping") >= 0) {
                        serial.writeString(JSON.stringify({ MicroBit_alive: "yes" }) + "\n")
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
            serial.writeString(JSON.stringify({ MicroBit: text, checksum: this.checksum(text) }) + "\n")
        }

        private checksum(text: string): number {
            // Sum of char codes mod 256 — matches R300's Checksum256() for
            // ASCII text (aimo_v1_edu_microbit_board.cc).
            let sum = 0
            for (let k = 0; k < text.length; k++) {
                sum += text.charCodeAt(k)
            }
            return sum % 256
        }
    }

    /**
     * Connect to R300 over the P0/P1 UART link and start automatically
     * answering its keep-alive pings.
     */
    //% blockId=r300_connect
    //% block="connect to R300"
    //% weight=100
    //% blockSetVariable=r300Link
    export function connect(): R300Link {
        return new R300Link()
    }
}
