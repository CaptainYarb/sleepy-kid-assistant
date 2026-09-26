import { execFile } from 'node:child_process';

// Powers the adapter radio on or off; bluetoothctl works without sudo for users in the bluetooth group.
export function applyBluetooth(enabled: boolean) {
	if (process.platform !== 'linux') {
		return;
	}
	execFile('bluetoothctl', ['power', enabled ? 'on' : 'off'], (err) => {
		if (err) {
			console.warn(`[bluetooth] could not power ${enabled ? 'on' : 'off'}: ${err.message}`);
		}
	});
}
