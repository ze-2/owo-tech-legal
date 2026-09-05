import { chromium } from '@playwright/test';
import { spawn } from 'child_process';
import { once } from 'events';

const ffmpeg = '/nix/store/b0x2l24q143a4wygaa8f6p5c7l1xrmqr-ffmpeg-headless-8.1-bin/bin/ffmpeg';
const encoder = spawn(ffmpeg, ['-y', '-loglevel', 'debug', '-f', 'image2pipe', '-framerate', '15', '-vcodec', 'png', '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '/tmp/test-15fps.mp4'], { stdio: ['pipe', 'pipe', 'pipe'] });
let err = '';
encoder.stderr.on('data', (c: Buffer) => { err += c.toString(); console.log('[ffmpeg stderr]', c.toString().trim()); });
encoder.stdout.on('data', (c: Buffer) => { console.log('[ffmpeg stdout]', c.toString().trim()); });
const done = once(encoder, 'close');

const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.setContent('<html><body style="background:blue"><h1>Test Frame</h1></body></html>');

let frames = 0;
const start = Date.now();
while (frames < 30) {
  const img = await page.screenshot();
  console.log(`Frame ${frames}, size: ${img.length} bytes`);
  const ok = encoder.stdin.write(img);
  console.log(`write() returned: ${ok}`);
  if (!ok) {
    console.log('Waiting for drain...');
    await once(encoder.stdin, 'drain');
    console.log('drain fired');
  }
  frames++;
  await new Promise(r => setTimeout(r, 67));
}
encoder.stdin.end();
const [code] = await done;
console.log(`Wrote ${frames} frames in ${Date.now() - start}ms, ffmpeg exit: ${code}`);
await browser.close();