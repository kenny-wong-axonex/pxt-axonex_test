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
        for (let i = 0; i < data.length; i++) {
            sum1 = (sum1 + data.charCodeAt(i)) % 255;
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


