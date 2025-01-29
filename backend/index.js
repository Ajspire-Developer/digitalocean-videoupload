const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const ffmpeg = require('fluent-ffmpeg');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const os = require("os");

// Initialize app and server
const app = express();
const port = 9999;
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

let conversionHistory = [];

// Configure WebSocket
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Enable CORS
app.use(cors());
app.use(express.json());

// Configure Multer for file uploads
const uploadDir = path.join(os.homedir(), 'AppData', 'Roaming', 'digitalocean-videoupload', 'Uploads');

// Ensure the directory exists
const ensureDirectoryExists = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};
ensureDirectoryExists(uploadDir);

// Configure multer for file uploads
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 1 * 1024 * 1024 * 1024 }, // 1 GB limit
}).single('file');

// Configure DigitalOcean Spaces (S3-Compatible)
const s3Client = new S3Client({
  region: 'blr1',
  endpoint: 'https://blr1.digitaloceanspaces.com',
  credentials: {
    accessKeyId: 'DO801GVH4W7HEDXT34FK', // Replace with your key
    secretAccessKey: 'tM7jX11PewPetWKFWuo4OScf/ey7H8wgje1LYf8rgsU', // Replace with your secret
  },
});

// Function to remove local directory after upload
const removeDirectory = (directoryPath) => {
  try {
    if (fs.existsSync(directoryPath)) {
      // Read all files and delete them first
      fs.readdirSync(directoryPath).forEach((file) => {
        const filePath = path.join(directoryPath, file);
        if (fs.lstatSync(filePath).isDirectory()) {
          removeDirectory(filePath); // Recursively delete subdirectories
        } else {
          fs.unlinkSync(filePath); // Delete file
        }
      });

      // Remove the directory itself
      fs.rmdirSync(directoryPath);
      console.log(`Directory removed: ${directoryPath}`);
    }
  } catch (error) {
    console.error(`Failed to remove directory: ${directoryPath}`, error.message);
  }
};

// Function to add delay for retry mechanism
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Function to upload a file with retry logic
async function uploadFileWithRetry(filePath, fileName, subjectName, lessonName, maxRetries = 100) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const fileStream = fs.createReadStream(filePath);
      const uploadParams = {
        Bucket: 'istepup',
        Key: `${subjectName}/${lessonName}/${fileName}`,
        Body: fileStream,
        ACL: 'public-read',
        ContentType: fileName.endsWith('.m3u8') ? 'application/x-mpegURL' : 'video/MP2T',
      };

      await s3Client.send(new PutObjectCommand(uploadParams));
      console.log(`Uploaded: ${fileName} (Attempt ${attempt + 1})`);
      return true; // Successful upload
    } catch (uploadErr) {
      console.error(`Failed to upload ${fileName} (Attempt ${attempt + 1}):`, uploadErr.message);
      attempt++;
      if (attempt < maxRetries) {
        console.log(`Retrying in 3 seconds...`);
        await delay(3000); // Wait before retrying
      } else {
        console.log(`Upload failed after ${maxRetries} attempts.`);
        return false; // Indicate failure
      }
    }
  }
}

// Function to upload all files with retry logic
async function uploadAllFiles(lessonDir, subjectName, lessonName) {
  const filesToUpload = fs.readdirSync(lessonDir);
  const totalFiles = filesToUpload.length;
  let completedFiles = 0;

  for (const fileName of filesToUpload) {
    const filePath = path.join(lessonDir, fileName);
    const success = await uploadFileWithRetry(filePath, fileName, subjectName, lessonName);

    if (success) {
      completedFiles++;
      io.emit('uploadCloudProgress', {
        progress: Math.round((completedFiles / totalFiles) * 100),
        total_completed_files: completedFiles,
        total_files: totalFiles,
      });
    }
  }
}

// POST route to handle uploads and conversion
app.post('/upload', (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      console.error('Upload error:', err);
      return res.status(400).json({ error: 'File upload failed', details: err.message });
    }

    try {
      const { file } = req;
      const subjectName = req.body.subjectName?.replace(/\s+/g, '-');
      const lessonName = req.body.lessonName?.replace(/\s+/g, '-');

      if (!file || !subjectName || !lessonName) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Directories for conversion
      const subjectDir = path.join(uploadDir, subjectName);
      const lessonDir = path.join(subjectDir, lessonName);

      if (!fs.existsSync(subjectDir)) fs.mkdirSync(subjectDir, { recursive: true });
      if (!fs.existsSync(lessonDir)) fs.mkdirSync(lessonDir, { recursive: true });

      const inputFilePath = file.path;
      const outputFileName = 'playlist.m3u8';
      const outputFilePath = path.join(lessonDir, outputFileName);

      // Convert to HLS
      ffmpeg(inputFilePath)
        .output(outputFilePath)
        .outputOptions([
          '-preset fast',
          '-threads 4',
          '-c:v copy',
          '-c:a copy',
          '-hls_time 4',
          '-hls_playlist_type vod',
          '-hls_segment_filename', path.join(lessonDir, 'video%03d.ts'),
        ])
        .on('end', async () => {
          console.log('Conversion completed.');

          // Upload files to S3
          await uploadAllFiles(lessonDir, subjectName, lessonName);

          // Add entry to conversion history
          conversionHistory.push({
            subjectName,
            lessonName,
            outputPath: `https://istepup.blr1.digitaloceanspaces.com/${subjectName}/${lessonName}/playlist.m3u8`,
            timestamp: new Date().toISOString(),
          });

          // Keep only the last 10 entries
          if (conversionHistory.length > 10) {
            conversionHistory.shift();
          }

        // Call the function to remove the lesson directory
removeDirectory(lessonDir);

// Check if the subject directory is empty and remove it
if (fs.existsSync(subjectDir) && fs.readdirSync(subjectDir).length === 0) {
  removeDirectory(subjectDir);
}

          res.status(200).json({
            message: 'Conversion and upload successful',
            outputFile: `https://istepup.blr1.digitaloceanspaces.com/${subjectName}/${lessonName}/playlist.m3u8`,
          });
        })
        .on('error', (conversionError) => {
          console.error('Conversion error:', conversionError);
          res.status(500).json({ error: 'Conversion failed', details: conversionError.message });
        })
        .run();
    } catch (unexpectedError) {
      console.error('Unexpected error:', unexpectedError);
      res.status(500).json({ error: 'Internal server error', details: unexpectedError.message });
    }
  });
});

// Get conversion history
app.get('/history', (req, res) => {
  res.status(200).json(conversionHistory);
});

// Start the server
server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
