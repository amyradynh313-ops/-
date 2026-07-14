// سرور «یارِ امتحان»
// این سرور کلید API رو مخفی نگه می‌داره، حساب کاربری/تاریخچه چت رو مدیریت می‌کنه،
// و درخواست‌های چت (شامل عکس/ویدیو) رو به Google Gemini فوروارد می‌کنه.

require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET;

if (!GEMINI_API_KEY) {
  console.error('❌ متغیر GEMINI_API_KEY تنظیم نشده.');
  process.exit(1);
}
if (!JWT_SECRET) {
  console.error('❌ متغیر JWT_SECRET تنظیم نشده. یه رشته تصادفی طولانی توی .env بذار.');
  process.exit(1);
}

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // حداکثر ۱۵ مگابایت
});

const SYSTEM_PROMPT = `تو «یارِ امتحان» هستی؛ یک دستیار هوش‌مصنوعیِ فارسی‌زبان و متخصصِ کمک به دانش‌آموزان ایرانی برای آمادگی در امتحانات نهایی و مستمر پایه‌های هفتم، هشتم، نهم (دوره اول متوسطه) و یازدهم و دوازدهم (دوره دوم متوسطه، رشته‌های ریاضی‌فیزیک، تجربی و انسانی).

قوانین رفتار تو:
- همیشه به فارسیِ روان، محاوره‌ایِ محترمانه و دوستانه (نه رسمیِ خشک) جواب بده، مگر کاربر زبان دیگه‌ای بخواد.
- تخصصت شامل تمام دروس این پایه‌هاست: ریاضی، فیزیک، شیمی، زیست‌شناسی، ادبیات فارسی، عربی، زبان انگلیسی، دینی، مطالعات اجتماعی، علوم تجربی، آمار و احتمال، هندسه، حسابان، جامعه‌شناسی، فلسفه و منطق (بسته به رشته).
- اگه کاربر عکس یا ویدیو از یه سوال، جزوه، یا تمرین بفرسته، محتواش رو تحلیل کن و کمکش کن (مثلاً حل مسئله، توضیح مفهوم، تصحیح جواب).
- وقتی سوال درسی می‌پرسن: مفهوم رو واضح توضیح بده، در صورت لزوم مثال یا سوال نمونه بزن، و روش حل رو قدم‌به‌قدم نشون بده—نه فقط جواب خشک.
- لحنت باید دلگرم‌کننده و حامی باشه؛ استرس امتحان رو کم کن، نه اضافه.
- اگه سوالی خارج از حوزه درسی/تحصیلی بود، مودبانه و کوتاه جواب بده و در صورت امکان به بحث درسی برگرد.
- اگه از سازنده یا هویت خودت پرسیدن: بگو سازنده‌ات امیررضا است، عضو تیم amir game، و این ابزار کاملاً رایگانه.
- پاسخ‌هات رو برای موبایل مناسب و نه خیلی طولانی نگه‌دار.
- از فرمول‌نویسی ساده و خوانا استفاده کن، نه LaTeX.`;

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';

// ==================== احراز هویت ====================

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'وارد حساب نشدی.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: 'نشست منقضی شده. دوباره وارد شو.' });
  }
}

app.post('/api/signup', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password || password.length < 4) {
      return res.status(400).json({ error: 'نام کاربری و رمز عبور (حداقل ۴ کاراکتر) لازمه.' });
    }
    const existing = db.get('users').find({ username }).value();
    if (existing) return res.status(400).json({ error: 'این نام کاربری قبلاً گرفته شده.' });

    const hash = await bcrypt.hash(password, 10);
    const user = { id: Date.now().toString(), username, password: hash, createdAt: new Date().toISOString() };
    db.get('users').push(user).write();

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: user.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطای سرور در ثبت‌نام' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = db.get('users').find({ username }).value();
    if (!user) return res.status(400).json({ error: 'نام کاربری یا رمز عبور اشتباهه.' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ error: 'نام کاربری یا رمز عبور اشتباهه.' });
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: user.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطای سرور در ورود' });
  }
});

// ==================== گفتگوها (تاریخچه) ====================

app.get('/api/conversations', authMiddleware, (req, res) => {
  const list = db.get('conversations')
    .filter({ userId: req.userId })
    .orderBy(['createdAt'], ['desc'])
    .map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt }))
    .value();
  res.json({ conversations: list });
});

app.post('/api/conversations', authMiddleware, (req, res) => {
  const conv = {
    id: Date.now().toString(),
    userId: req.userId,
    title: 'گفتگوی جدید',
    createdAt: new Date().toISOString(),
  };
  db.get('conversations').push(conv).write();
  res.json({ conversation: conv });
});

app.get('/api/conversations/:id/messages', authMiddleware, (req, res) => {
  const conv = db.get('conversations').find({ id: req.params.id, userId: req.userId }).value();
  if (!conv) return res.status(404).json({ error: 'گفتگو پیدا نشد.' });
  const messages = db.get('messages')
    .filter({ conversationId: conv.id })
    .orderBy(['createdAt'], ['asc'])
    .value();
  res.json({ messages });
});

app.delete('/api/conversations/:id', authMiddleware, (req, res) => {
  const conv = db.get('conversations').find({ id: req.params.id, userId: req.userId }).value();
  if (!conv) return res.status(404).json({ error: 'گفتگو پیدا نشد.' });
  db.get('conversations').remove({ id: req.params.id }).write();
  db.get('messages').remove({ conversationId: req.params.id }).write();
  res.json({ ok: true });
});

// ==================== چت (متن + عکس/ویدیو) ====================

app.post('/api/chat', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const { conversationId, message } = req.body;
    if (!conversationId) return res.status(400).json({ error: 'گفتگو مشخص نشده.' });

    const conv = db.get('conversations').find({ id: conversationId, userId: req.userId }).value();
    if (!conv) return res.status(404).json({ error: 'گفتگو پیدا نشد.' });

    const userMsg = {
      id: Date.now().toString() + '-u',
      conversationId,
      role: 'user',
      content: message || '',
      hasFile: !!req.file,
      fileName: req.file ? req.file.originalname : null,
      createdAt: new Date().toISOString(),
    };
    db.get('messages').push(userMsg).write();

    // ساخت تاریخچه‌ی متنی برای ارسال به Gemini (بدون فایل‌های قدیمی، فقط فایل فعلی)
    const history = db.get('messages')
      .filter({ conversationId })
      .orderBy(['createdAt'], ['asc'])
      .value();

    const contents = history.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content || (m.hasFile ? '[یه فایل ضمیمه شد]' : '') }],
    }));

    if (req.file) {
      const base64 = req.file.buffer.toString('base64');
      contents[contents.length - 1].parts.push({
        inlineData: { mimeType: req.file.mimetype, data: base64 },
      });
    }

    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Gemini API error:', data);
      return res.status(response.status).json({
        error: (data && data.error && data.error.message) || 'خطای نامشخص از سرویس هوش‌مصنوعی',
      });
    }

    const reply = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n') || 'پاسخی دریافت نشد.';

    const botMsg = {
      id: Date.now().toString() + '-b',
      conversationId,
      role: 'assistant',
      content: reply,
      createdAt: new Date().toISOString(),
    };
    db.get('messages').push(botMsg).write();

    if (conv.title === 'گفتگوی جدید' && message) {
      db.get('conversations').find({ id: conversationId }).assign({ title: message.slice(0, 30) }).write();
    }

    res.json({ reply });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'خطای داخلی سرور' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ یارِ امتحان روی http://localhost:${PORT} در حال اجراست`);
});
