/* eslint-disable @typescript-eslint/no-unused-vars */
import { execSync } from 'child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';

function isBinaryAvailable(command) {
	try {
		execSync(`${command} -version`, { stdio: 'ignore' });
		return true;
	}
	catch (error) {
		return false;
	}
}

function getFFmpegPath() {
	if (isBinaryAvailable('ffmpeg')) {
		return 'ffmpeg';
	}
	else {
		return ffmpegInstaller.path;
	}
}

function getFfprobePath() {
	if (isBinaryAvailable('ffprobe')) {
		return 'ffprobe';
	}
	else {
		return ffprobeInstaller.path;
	}
}

const ffmpegPath = getFFmpegPath();
const ffprobePath = getFfprobePath();

export { ffmpegPath, ffprobePath };