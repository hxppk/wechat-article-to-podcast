const GeminiTTS = require('../src/services/tts/GeminiTTS');
const fs = require('fs');
const path = require('path');
const util = require('util');

// Mock exec to avoid ffmpeg requirement for this test
// We just want to verify chunking and file assembly
const exec = require('child_process').exec;
// We will mock execAsync in the class if possible or just let it fail/pass
// But GeminiTTS uses `execAsync` from a promisified exec.
// It's harder to mock internal require, but we can mock the method if we extend or just ignore the ffmpeg error/output for now.
// actually, we can just let ffmpeg fail or not run if we mock the whole method.

class MockGeminiTTS extends GeminiTTS {
  constructor() {
    // Skip super constructor to avoid API key check if it checks it
    // But GeminiTTS constructor checks API key.
    // We need to set a dummy API key env var.
    process.env.GEMINI_API_KEY = 'dummy';
    super();
    this.callCount = 0;
    this.receivedTexts = [];
  }

  async synthesizeWithRetry(text, speakers, outputPath) {
    this.callCount++;
    this.receivedTexts.push(text);
    console.log(`[Mock] synthesizeWithRetry called. Text length: ${text.length}`);
    
    // Write 1 second of silence (or just dummy bytes) as PCM
    // 24000 Hz, 16-bit (2 bytes), 1 channel = 48000 bytes/sec
    const dummyPcm = Buffer.alloc(100); 
    fs.writeFileSync(outputPath, dummyPcm);
  }
}

// We also need to mock execAsync used in synthesize for ffmpeg
// Since we can't easily mock the module level variable, we can just hope ffmpeg exists or catch the error.
// Or we can overwrite the method if we could. 
// But `synthesize` calls `execAsync`.
// Let's just try to run it. If ffmpeg fails, that's fine, as long as we see the chunking logs.
// We can catch the error in the test.

async function runTest() {
  const tts = new MockGeminiTTS();
  
  // Create 50 dummy dialogue items
  const dialogues = [];
  for (let i = 0; i < 50; i++) {
    dialogues.push({
      speaker: i % 2 === 0 ? 'Speaker_A' : 'Speaker_B',
      text: `This is sentence number ${i}. It is short.`
    });
  }

  const outputDir = path.join(__dirname, '../data/test');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const outputPath = path.join(outputDir, 'test_output.mp3');

  console.log('Starting chunking test...');
  
  try {
    // We expect ffmpeg to fail if not installed or if we provided bad pcm, 
    // but the chunking part happens before ffmpeg.
    await tts.synthesize(dialogues, outputPath);
  } catch (error) {
    console.log('Caught expected error (likely ffmpeg or network):', error.message);
  }

  console.log('---------------------------------------------------');
  console.log(`Total calls to synthesizeWithRetry: ${tts.callCount}`);
  
  // Expected chunks: 50 items / 20 items per chunk = 3 chunks (20, 20, 10)
  if (tts.callCount === 3) {
    console.log('SUCCESS: Correct number of chunks (3).');
  } else {
    console.error(`FAILURE: Expected 3 chunks, got ${tts.callCount}`);
    process.exit(1);
  }

  // Cleanup
  try {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    const tempPcm = path.join(outputDir, 'test_output_combined.pcm');
    if (fs.existsSync(tempPcm)) fs.unlinkSync(tempPcm);
  } catch (e) {}
}

runTest();
