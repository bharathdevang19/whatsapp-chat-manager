const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { Client } = require('pg');
const path = require('path');
const env = require('dotenv');

// Load environment variables from a .env file
env.config();

const app = express();

// Multer configuration for handling file uploads
const upload = multer({
  dest: 'uploads/', // Directory where files will be temporarily stored
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // Only allow .txt files
    if (ext !== '.txt') return cb(new Error('Only .txt files are allowed'));
    cb(null, true);
  }
});

// Set EJS as the templating engine
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));

// Database client connection
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Required for Heroku PostgreSQL connections
});

// Connect to PostgreSQL
client.connect()
  .then(() => console.log('Connected to database'))
  .catch(err => console.error('Database connection error:', err));

// Route to render the home page
app.get('/', (req, res) => {
  res.render('index', { results: undefined, error: null });
});

// Route to handle file upload
app.post('/upload', upload.single('chat'), async (req, res) => {
  if (!req.file) {
    // If no file is uploaded or the wrong file type is uploaded
    return res.render('index', { results: undefined, error: 'No file uploaded or wrong file type.' });
  }

  const filePath = req.file.path;

  try {
    // Read the uploaded file content
    const data = fs.readFileSync(filePath, 'utf8');
    const lines = data.split('\n'); // Split content by lines
    const regex = /^(\d{1,2}\/\d{1,2}\/\d{2,4}), (\d{1,2}:\d{2})(?:\s?(AM|PM|am|pm))? - ([^:]+): (.+)$/;

    // Clear existing messages from the database before inserting new ones
    await client.query('DELETE FROM messages');

    // Process each line in the file
    for (const line of lines) {
      const match = line.match(regex);
      if (match) {
        let [_, date, time, meridiem, sender, message] = match;

        // Reformat the date and time
        const [day, month, year] = date.split('/');
        const formattedDate = `${year.length === 2 ? '20' + year : year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        
        let [hour, minute] = time.split(':');
        hour = parseInt(hour, 10);

        // Adjust time for AM/PM format
        if (meridiem) {
          if (meridiem.toLowerCase() === 'pm' && hour < 12) hour += 12;
          if (meridiem.toLowerCase() === 'am' && hour === 12) hour = 0;
        }
        const formattedTime = `${hour.toString().padStart(2, '0')}:${minute}:00`;

        // Insert the parsed message into the database
        await client.query('INSERT INTO messages (message_date, message_time, sender, message) VALUES ($1, $2, $3, $4)', [formattedDate, formattedTime, sender, message]);
      }
    }

    // Delete the uploaded file after processing
    fs.unlinkSync(filePath);
    res.redirect('/all'); // Redirect to the page showing all messages
  } catch (err) {
    console.error('Upload error:', err);
    // Delete the file if an error occurred
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.status(500).render('index', { results: undefined, error: 'Something went wrong while uploading.' });
  }
});

// Route to handle search functionality
app.get('/search', async (req, res) => {
  const q = req.query.q ? req.query.q.trim() : ''; // Get the search query from the URL

  try {
    let results = [];
    if (q) {
      // Search the database for messages matching the query
      const { rows } = await client.query(`
        SELECT * FROM messages
        WHERE
          CAST(id AS TEXT) ILIKE $1 OR
          message_date::TEXT ILIKE $1 OR
          sender ILIKE $1 OR
          message ILIKE $1
        ORDER BY id ASC
      `, [`%${q}%`]);
      results = rows; // Store the results in the `results` array
    }
    res.render('index', { results, error: null });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).render('index', { results: undefined, error: 'Error while searching.' });
  }
});

// Route to fetch and display all messages
app.get('/all', async (req, res) => {
  try {
    // Get all messages from the database
    const { rows } = await client.query('SELECT * FROM messages ORDER BY id ASC');
    res.render('index', { results: rows, error: null });
  } catch (err) {
    console.error('Fetch all error:', err);
    res.status(500).render('index', { results: undefined, error: 'Error while fetching messages.' });
  }
});

// Set the port and start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
