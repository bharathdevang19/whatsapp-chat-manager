const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { Client } = require('pg');
const path = require('path');
const env = require('dotenv');

env.config();

const app = express();

const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.txt') return cb(new Error('Only .txt files are allowed'));
    cb(null, true);
  }
});

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

client.connect().then(() => console.log('Connected to database')).catch(err => console.error('Database connection error:', err));

app.get('/', (req, res) => {
  res.render('index', { results: undefined, error: null });
});

app.post('/upload', upload.single('chat'), async (req, res) => {
  if (!req.file) return res.render('index', { results: undefined, error: 'No file uploaded or wrong file type.' });

  const filePath = req.file.path;

  try {
    const data = fs.readFileSync(filePath, 'utf8');
    const lines = data.split('\n');
    const regex = /^(\d{1,2}\/\d{1,2}\/\d{2,4}), (\d{1,2}:\d{2})(?:\s?(AM|PM|am|pm))? - ([^:]+): (.+)$/;

    await client.query('DELETE FROM messages');

    for (const line of lines) {
      const match = line.match(regex);
      if (match) {
        let [_, date, time, meridiem, sender, message] = match;
        const [day, month, year] = date.split('/');
        const formattedDate = `${year.length === 2 ? '20' + year : year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        let [hour, minute] = time.split(':');
        hour = parseInt(hour, 10);
        if (meridiem) {
          if (meridiem.toLowerCase() === 'pm' && hour < 12) hour += 12;
          if (meridiem.toLowerCase() === 'am' && hour === 12) hour = 0;
        }
        const formattedTime = `${hour.toString().padStart(2, '0')}:${minute}:00`;

        await client.query('INSERT INTO messages (message_date, message_time, sender, message) VALUES ($1, $2, $3, $4)', [formattedDate, formattedTime, sender, message]);
      }
    }

    fs.unlinkSync(filePath);
    res.redirect('/all');
  } catch (err) {
    console.error('Upload error:', err);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.status(500).render('index', { results: undefined, error: 'Something went wrong while uploading.' });
  }
});

app.get('/search', async (req, res) => {
  const q = req.query.q ? req.query.q.trim() : '';

  try {
    let results = [];
    if (q) {
      const { rows } = await client.query(`
        SELECT * FROM messages
        WHERE
          CAST(id AS TEXT) ILIKE $1 OR
          message_date::TEXT ILIKE $1 OR
          sender ILIKE $1 OR
          message ILIKE $1
        ORDER BY id ASC
      `, [`%${q}%`]);
      results = rows;
    }
    res.render('index', { results, error: null });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).render('index', { results: undefined, error: 'Error while searching.' });
  }
});

app.get('/all', async (req, res) => {
  try {
    const { rows } = await client.query('SELECT * FROM messages ORDER BY id ASC');
    res.render('index', { results: rows, error: null });
  } catch (err) {
    console.error('Fetch all error:', err);
    res.status(500).render('index', { results: undefined, error: 'Error while fetching messages.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
