// دیتابیس ساده - فایل JSON برای ذخیره کاربرها، گفتگوها و پیام‌ها
// (برای پروژه‌های کوچیک کافیه، نیاز به نصب دیتابیس واقعی نیست)

const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');

const adapter = new FileSync(path.join(__dirname, 'data.json'));
const db = low(adapter);

db.defaults({ users: [], conversations: [], messages: [] }).write();

module.exports = db;
