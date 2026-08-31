// Define non-editable API actions
enum ApiCommand {
    //% block="Get Status"
    GetStatus,
    //% block="Set Sensor Mode"
    SetSensorMode,
    //% block="Reset Board"
    ResetBoard
}

//% color="#0fbc11" weight=100 namespace="ApiTx"
namespace ApiTx {
    /**
     * Send standardized API payload over UART
     */
    //% block="send API command %cmd over UART"
    //% cmd.fieldEditor="gridpicker"
    //% cmd.fieldOptions.columns=3
    export function sendApiPayload(cmd: ApiCommand) {
        let actionStr = "";
        let actionData: any = {};

        // 1. Build specific action and data payload
        switch (cmd) {
            case ApiCommand.GetStatus:
                actionStr = "getStatus";
                actionData = { reqId: 101 };
                break;
            case ApiCommand.SetSensorMode:
                actionStr = "setMode";
                actionData = { mode: "active", rate: 500 };
                break;
            case ApiCommand.ResetBoard:
                actionStr = "reset";
                actionData = { hard: true };
                break;
        }

        // 2. Wrap into a standardized structure containing tx, action, and data
        let payload = {
            ts: input.runningTime(), // Uses micro:bit uptime (ms) as the transmission timestamp
            action: actionStr,
            data: actionData
        };

        // 3. Stringify and send over UART
        console.log(payload)
        let jsonString = JSON.stringify(payload);
        serial.writeLine(jsonString);
    }
}
