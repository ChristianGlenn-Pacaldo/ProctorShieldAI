# 🛡️ ProctorShield AI — AI-Powered Proctoring System

ProctorShield AI is a modern Next.js application that provides real-time AI-powered exam monitoring, webcam snapshot logs, and automated cheating analysis reports using Gemini Vision AI.

---

## 🚀 Getting Started (Classmate Setup Guide)

Follow these steps to set up and run the project locally on your machine:

### 1. Clone & Install Dependencies
First, clone the repository and navigate into the project directory:
```bash
git clone https://github.com/ChristianGlenn-Pacaldo/ProctorShieldAI.git
cd ProctorShieldAI
```

Install the required npm packages:
```bash
npm install
```

### 2. Configure Environment Variables
Environment files (`.env`) are ignored by Git for security. You must create your own:
1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
   *(On Windows Command Prompt, run: `copy .env.example .env`)*
   *(On Windows PowerShell, run: `copy .env.example .env`)*
2. Open the new `.env` file and verify the variables.
3. **Important:** Add a valid Gemini API key to `GEMINI_API_KEY=""`. Get a free key from [Google AI Studio](https://aistudio.google.com/).

### 3. Initialize the Database
This application uses **Prisma ORM** with **PostgreSQL**. To set up your database schema and create default roles (student, teacher, admin) and demo accounts:

1. Generate the Prisma client:
   ```bash
   npx prisma generate
   ```
2. Sync the database schema (creates the database tables):
   ```bash
   npx prisma db push
   ```
3. Seed the database (essential for creating default roles and demo users):
   ```bash
   npm run db:seed
   ```

### 4. Start the Application
Now you can start the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 👥 Demo Logins (Created during Seeding)
Once you seed the database, you can log in immediately using these pre-configured accounts:

* **Student Portal:**
  * Email: `student@demo.com`
  * Password: `student123`
* **Teacher Portal:**
  * Email: `teacher@demo.com`
  * Password: `teacher123`
* **Admin Portal:**
  * Email: `admin@proctorshield.ai`
  * Password: `admin123`
