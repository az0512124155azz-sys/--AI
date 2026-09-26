# AI Browser Agent

תוסף Chrome לשליטה בדפדפן עם Gemini, OpenRouter ו-ChatGPT Web (המנוי שלך).

## תכונות

- צ'אט Side Panel עם Streaming בזמן אמת
- שלושה ספקים: Gemini, OpenRouter (מודלים חינמיים), ChatGPT Web
- ChatGPT Web משתמש במנוי הקיים שלך - ללא API Key
- שליטה בדפדפן: קריאת דף, לחיצה, הקלדה, גלילה, חילוץ טקסט
- קריאת טקסט נבחר אוטומטית
- העלאת קבצים לניתוח
- מצב כהה אוטומטי
- שמירת היסטוריית שיחה

## התקנה

1. שכפל את הריפו:
   git clone https://github.com/az0512124155azz-sys/--AI.git
   cd --AI

2. פתח chrome://extensions

3. הפעל Developer mode (פינה עליונה ימנית)

4. לחץ Load unpacked ובחר את תיקיית הפרויקט

5. לחץ על אייקון התוסף בסרגל -> ה-Side Panel יפתח

## הגדרה

### Gemini
1. השג מפתח: https://aistudio.google.com/apikey
2. בתוסף: לחץ הגדרות -> הזן Gemini API Key

### OpenRouter
1. השג מפתח: https://openrouter.ai/keys
2. בתוסף: לחץ הגדרות -> הזן OpenRouter API Key

### ChatGPT Web (המנוי שלך)
1. אין צורך ב-API Key
2. פתח טאב חדש של https://chatgpt.com
3. התחבר עם החשבון שלך
4. בתוסף: בחר "ChatGPT (המנוי שלי)" מהתפריט

## שימוש

- סימון טקסט בדף -> יופיע בסרגל ההקשר למעלה
- צ'אט - שאל שאלות, בקש לסכם, לחפש
- פעולות - "לחץ על הכפתור הכחול", "גלול למטה", "פתח טאב חדש עם..."
- צירוף קובץ - לחץ על אייקון מצלמה לשליחת קוד/מסמכים לניתוח

## ארכיטקטורה

Side Panel -> Service Worker -> Gemini / OpenRouter
                           |
                           v
                    Content Script (DOM access)
                           |
                           v
                  chatgpt.com (בטאב רקע)

## מגבלות ChatGPT Web

- תלוי ב-DOM של ChatGPT (עלול להישבר בעדכוני UI)
- דורש טאב פתוח של chatgpt.com עם התחברות פעילה
- לא תומך ב-System Prompt דרך ה-DOM
- השתמש באחריותך

## רישיון

MIT