// Browser sessions carry no app data. Handle control frames without mistaking
// a ping, pong or a fragmented TCP packet for a closed window.
export function attachSessionFrames(socket) {
  let pending = Buffer.alloc(0);
  socket.on('data', bytes => {
    pending = Buffer.concat([pending, bytes]);
    while (pending.length >= 2) {
      const opcode = pending[0] & 15;
      const length = pending[1] & 127;
      if ((pending[0] & 0xf0) !== 0x80 || !(pending[1] & 0x80) || ![8, 9, 10].includes(opcode) || length > 125 || (opcode === 8 && length === 1)) { socket.destroy(); return; }
      if (pending.length < 6 + length) return;
      const payload = Buffer.from(pending.subarray(6, 6 + length));
      for (let index = 0; index < payload.length; index++) payload[index] ^= pending[2 + index % 4];
      pending = pending.subarray(6 + length);
      if (opcode === 8) { socket.end(Buffer.concat([Buffer.from([0x88, length]), payload])); return; }
      if (opcode === 9) socket.write(Buffer.concat([Buffer.from([0x8a, length]), payload]));
    }
  });
}
