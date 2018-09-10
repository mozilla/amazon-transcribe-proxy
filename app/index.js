const AWS = require('aws-sdk');
const bodyParser = require('body-parser');
const childProcess = require('child_process');
const crypto = require('crypto');
const express = require('express');
const fs = require('fs');

const config = {
  port: process.env.PORT || 8000,
  s3Bucket: process.env.S3_BUCKET,
  region: process.env.REGION,
};

AWS.config.update({region: config.region});

const app = express();
const s3 = new AWS.S3();
const transcribeService = new AWS.TranscribeService();

const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(() => resolve(), ms));
};

const deleteObject = async (key) => {
  try {
    await s3.deleteObject({
      Bucket: config.s3Bucket,
      Key: key,
    }).promise();
  } catch (e) {
    console.log(`${Date.now()}: ERROR: Failed to delete object: ${e}`);
    // pass
  }
};

app.use(
  bodyParser.raw({
    limit: 1024000,
    type: () => true,
  })
);

app.post('/asr', async (req, res) => {
  const audio = req.body;
  const key = crypto.randomBytes(20).toString('hex');

  const rawFile = `/tmp/${key}.raw`;
  const wavFile = `/tmp/${key}.wav`;

  fs.writeFileSync(rawFile, audio);

  const proc = childProcess.spawnSync(
    'ffmpeg',
    ['-f', 's16le', '-ar', '16000', '-ac', '2', '-i', rawFile, wavFile]
  );

  try {
    fs.unlinkSync(rawFile);
  } catch (_e) {
    // pass
  }

  if (proc.status !== 0) {
    console.log(`${Date.now()}: ERROR: ffmpeg exited with code ${proc.status}`);
    try {
      fs.unlinkSync(wavFile);
    } catch (_e) {
      // pass
    }
    res.status(500).send('err');
    return;
  }

  let uploadResponse;
  try {
    uploadResponse = await s3.upload({
      Body: fs.readFileSync(wavFile),
      Bucket: config.s3Bucket,
      ContentType: 'audio/wav',
      Key: `${key}.wav`,
    }).promise();
  } catch (e) {
    console.log(`${Date.now()}: ERROR: Error saving to S3: ${e}`);
    try {
      fs.unlinkSync(wavFile);
    } catch (_e) {
      // pass
    }
    res.status(500).send('err');
    return;
  }

  try {
    fs.unlinkSync(wavFile);
  } catch (_e) {
    // pass
  }

  let transcribeResponse;
  try {
    transcribeResponse = await transcribeService.startTranscriptionJob({
      LanguageCode: 'en-US',
      Media: {
        MediaFileUri: uploadResponse.Location,
      },
      MediaFormat: 'wav',
      // MediaSampleRateHertz: 16000,
      OutputBucketName: config.s3Bucket,
      Settings: {
        ChannelIdentification: false,
        ShowSpeakerLabels: false,
      },
      TranscriptionJobName: key,
    }).promise();
  } catch (e) {
    console.log(`${Date.now()}: ERROR: Error starting transcription: ${e}`);
    await deleteObject(`${key}.wav`);
    res.status(500).send('err');
    return;
  }

  try {
    let status;
    do {
      await sleep(1000);
      transcribeResponse = await transcribeService.getTranscriptionJob({
        TranscriptionJobName: key,
      }).promise();
      status = transcribeResponse.TranscriptionJob.TranscriptionJobStatus;
    } while (status === 'IN_PROGRESS');
  } catch (e) {
    console.log(`${Date.now()}: ERROR: Error getting job status: ${e}`);
    await deleteObject(`${key}.wav`);
    res.status(500).send('err');
    return;
  }

  await deleteObject(`${key}.wav`);

  if (transcribeResponse.status === 'FAILED') {
    res.status(500).send('err');
    return;
  }

  let downloadResponse;
  try {
    downloadResponse = await s3.getObject({
      Bucket: config.s3Bucket,
      Key: `${key}.json`,
    }).promise();
  } catch (e) {
    console.log(
      `${Date.now()}: ERROR: Error getting transcription response: ${e}`);
    await deleteObject(`${key}.json`);
    res.status(500).send('err');
    return;
  }

  const transcribeResult = JSON.parse(downloadResponse.Body);
  await deleteObject(`${key}.json`);

  if (transcribeResult.results.transcripts.length === 0) {
    console.log(`${Date.now()}: ERROR: No results returned.`);
    res.status(500).send('err');
    return;
  }

  const transcript = transcribeResult.results.transcripts[0].transcript;
  const items = transcribeResult.results.items;

  let confidence = 0;
  let count = 0;
  for (const item of items) {
    for (const alternative of item.alternatives) {
      if (alternative.hasOwnProperty('confidence') &&
          alternative.confidence !== null) {
        count++;
        confidence += parseFloat(alternative.confidence);
      }
    }
  }

  if (count > 0) {
    confidence /= count;
  }

  console.log(`${Date.now()}: SUCCESS: "${transcript}" (${confidence})`);

  res.status(200).json({
    status: 'ok',
    data: [
      {
        confidence,
        text: transcript,
      },
    ],
  });
});

app.listen(config.port);
