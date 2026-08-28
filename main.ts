//% color=190 weight=100 icon="\uf1ec" block="R300_Blocks"
namespace R300 {
    //% block = "123 $text"
    //% text.defl="Hello"
    export function testing(text:string) {
        return text+" hey";

    }

    // note that Caml casing yields lower case
    // block text with spaces

    //% block
    export function transmit_uart_TXP0_RXP1() {
        serial.redirect(SerialPin.P0, SerialPin.P1, 115200);

        
    }
}
