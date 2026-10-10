"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUpRight, AudioLines, Brain, Camera, Check, ChevronDown, Eye, Fingerprint, Layers, LockKeyhole, Menu, Monitor, Play, ScanFace, Sparkles, Swords, X } from "lucide-react";
import BrandImage from "@/components/brand-image";
import Velaris from "@/components/velaris";
import { FREE_MANUAL_QUIZ_LIMIT, FREE_STUDENT_LIMIT_PER_QUIZ, PRO_MONTHLY_PRICE_PHP, PRO_STUDENT_LIMIT_PER_QUIZ } from "@/lib/subscription-rules";
import styles from "./landing.module.css";

const features = [
  { icon: ScanFace, label: "01 / VISION", title: "A watchful eye. A fairer quiz.", description: "Face and head-position monitoring helps flag sustained looking away, missing faces, and additional people during proctored quizzes." },
  { icon: Camera, label: "02 / EVIDENCE", title: "Every flag has a story.", description: "Review timestamped snapshots and recorded evidence alongside violation events, with the context you need to make a decision." },
  { icon: Brain, label: "03 / INSIGHTS", title: "From events to understanding.", description: "Gemini-assisted reports bring recorded events together into an assessment of risk for teachers to review." },
  { icon: Monitor, label: "04 / FOCUS", title: "Keep the classroom in focus.", description: "Track app and tab switching during monitored attempts and follow student activity in the Teacher Live Monitor." },
  { icon: AudioLines, label: "05 / AUDIO", title: "Listen for the unexpected.", description: "Audio monitoring flags elevated sound levels during proctored attempts, adding another signal to the evidence timeline." },
  { icon: Swords, label: "06 / POWER ARENA", title: "A little competition. A lot of learning.", description: "Turn quizzes into a multiplayer battle with gameplay points, power-ups, and a live leaderboard. Keep learning playful." },
];
const steps = [
  { num: "01", tag: "CREATE", title: "Your quiz, your way.", body: "Write questions yourself or use AI to help create them. Choose a proctored quiz or Power Arena, then share your room code." },
  { num: "02", tag: "JOIN", title: "One code. Everyone in.", body: "Students sign in, enter the quiz code, and complete the required checks. No separate app installation needed." },
  { num: "03", tag: "REVIEW", title: "See the bigger picture.", body: "Follow proctored sessions live, then review results, recorded events, and supporting evidence in your teaching workspace." },
];
const faqs = [
  { question: "How do students join a quiz?", answer: "Students enter the teacher’s quiz code here or in their Student Dashboard. They sign in and complete the required lobby checks before starting." },
  { question: "Does every head movement count as cheating?", answer: "Detection signals and recorded incidents are different. Proctored sessions use confirmation rules before recording qualifying events. Teachers can review the recorded evidence and AI report in context." },
  { question: "What is Power Arena?", answer: "Power Arena is a multiplayer quiz battle with points, power-ups, and leaderboards. Arena gameplay points are separate from percentage scores for proctored exams." },
  { question: "Can I use ProctorShieldAI on a phone?", answer: "Students can use a supported mobile browser. Proctored quizzes require camera and microphone permissions and a successful device check before the attempt starts." },
];

export default function LandingPage() {
  const router = useRouter();
  const [quickCode, setQuickCode] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const handleQuickJoin = (event: FormEvent) => {
    event.preventDefault();
    const clean = quickCode.trim().toUpperCase();
    router.push(clean ? `/join?code=${encodeURIComponent(clean)}` : "/join");
  };
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className={styles.page}>
      <div className={styles.background} aria-hidden="true"><Velaris bg="#012620" speed={2} grain={0.12} height="100%" /></div>
      <a href="#main-content" className={styles.skip}>Skip to content</a>
      <header className={styles.header}>
        <div className={styles.navbar}>
          <Link href="/" className={styles.brand} aria-label="ProctorShieldAI home">
            <BrandImage width={35} decorative preload />
            <span>ProctorShield<span className={styles.brandAccent}>AI</span><small>ACADEMIC INTEGRITY, REIMAGINED</small></span>
          </Link>
          <nav className={styles.desktopNav} aria-label="Main navigation">
            <a href="#features">Features</a><a href="#how">How it works</a><a href="#pricing">Pricing</a><a href="#faq">FAQs</a>
          </nav>
          <div className={styles.navActions}>
            <Link href="/login" className={styles.loginLink}>Log in <ArrowUpRight size={14} /></Link>
            <Link href="/login/teacher" className={styles.navButton}>Get started <ArrowRight size={16} /></Link>
            <button className={styles.menuButton} type="button" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="mobile-navigation">{menuOpen ? <X size={22} /> : <Menu size={22} />}</button>
          </div>
        </div>
        {menuOpen && <nav id="mobile-navigation" className={styles.mobileNav} aria-label="Mobile navigation">
          <a href="#features" onClick={closeMenu}>Features</a><a href="#how" onClick={closeMenu}>How it works</a><a href="#pricing" onClick={closeMenu}>Pricing</a><a href="#faq" onClick={closeMenu}>FAQs</a><Link href="/login">Log in</Link>
        </nav>}
      </header>

      <main id="main-content">
        <section className={`${styles.container} ${styles.hero}`} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <div className={styles.eyebrow}><span className={styles.liveDot} /> A BRIGHTER STANDARD FOR ONLINE QUIZZES</div>
            <h1 id="hero-title">Great minds.<br />Honest quizzes.<br /><span>Better learning.</span></h1>
            <p className={styles.heroDescription}>Give learning room to shine. Create engaging quizzes, monitor with AI, and review evidence with confidence — all in one classroom workspace.</p>
            <div className={styles.heroActions}>
              <Link href="/login/teacher" className={styles.primaryButton}>Create a quiz free <ArrowUpRight size={18} /></Link>
              <a href="#how" className={styles.textButton}><span className={styles.playIcon}><Play size={12} fill="currentColor" /></span> See how it works</a>
            </div>
            <div className={styles.heroNote}><Check size={15} /> Free to start <span>·</span> Browser-based <span>·</span> Built for educators</div>
            <form onSubmit={handleQuickJoin} className={styles.quickJoin}>
              <div className={styles.joinHeading}><span><Swords size={17} /> Here to join a quiz?</span><span className={styles.studentTag}>FOR STUDENTS</span></div>
              <div className={styles.joinInputRow}>
                <label htmlFor="quiz-code" className={styles.srOnly}>Quiz room code</label>
                <input id="quiz-code" type="text" value={quickCode} onChange={event => setQuickCode(event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 16))} placeholder="Enter quiz code · PS-4821" autoComplete="off" autoCapitalize="characters" spellCheck={false} />
                <button type="submit">Join quiz <ArrowRight size={17} /></button>
              </div>
            </form>
          </div>
          <div className={styles.heroVisual}>
            <div className={styles.visualHalo} aria-hidden="true" />
            <div className={styles.logoStage}>
              <div className={styles.stageTop}><span><span className={styles.liveDot} /> THE CLASSROOM IN GOOD HANDS</span><Fingerprint size={20} /></div>
              <BrandImage variant="logo" width={470} preload className={styles.heroLogo} />
              <div className={styles.stageBottom}><span>Confidence in every assessment.</span><LockKeyhole size={15} /></div>
            </div>
            <div className={`${styles.floatingCard} ${styles.visionCard}`}><span className={styles.floatingIcon}><Eye size={21} /></span><div><strong>AI-assisted monitoring</strong><small>A little more peace of mind.</small></div><Check size={16} /></div>
            <div className={`${styles.floatingCard} ${styles.evidenceCard}`}><span className={styles.floatingIcon}><Layers size={21} /></span><div><strong>Evidence with context</strong><small>Review. Understand. Decide.</small></div></div>
            <span className={styles.visualCaption}>ONE CONNECTED CLASSROOM WORKSPACE</span>
          </div>
        </section>

        <div className={styles.capabilityStrip}><div className={styles.container}>
          <span className={styles.stripLabel}>THOUGHTFULLY CONNECTED</span>
          <span><ScanFace size={20} /> AI monitoring</span><span><Camera size={20} /> Evidence replay</span><span><Brain size={20} /> Gemini insights</span><span><Swords size={20} /> Power Arena</span>
        </div></div>

        <section id="features" className={`${styles.container} ${styles.section}`} aria-labelledby="features-title">
          <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>LESS GUESSWORK. MORE CLARITY.</span><h2 id="features-title">Your classroom.<br /><span>A stronger foundation.</span></h2></div><p>From the first question to the final review, bring your assessment tools together without losing the human perspective.</p></div>
          <div className={styles.featuresGrid}>{features.map(({ icon: Icon, label, title, description }) => <article key={label} className={styles.featureCard}>
            <div className={styles.featureTop}><span className={styles.featureIcon}><Icon size={24} /></span><span>{label}</span></div><h3>{title}</h3><p>{description}</p>
          </article>)}</div>
        </section>

        <section id="how" className={styles.howSection} aria-labelledby="how-title"><div className={`${styles.container} ${styles.section}`}>
          <div className={styles.centerHeading}><span className={styles.eyebrow}>A SIMPLE FLOW, FROM START TO FINISH</span><h2 id="how-title">Good teaching.<br /><span>Fewer moving parts.</span></h2><p>Three steps. One place to make it happen.</p></div>
          <div className={styles.stepsGrid}>{steps.map(step => <article key={step.num} className={styles.stepCard}><div className={styles.stepNumber}>{step.num}<ArrowRight size={20} /></div><span className={styles.stepTag}>{step.tag}</span><h3>{step.title}</h3><p>{step.body}</p></article>)}</div>
          <div className={styles.arenaBanner}><div className={styles.arenaBadge}><Swords size={30} /></div><div><span className={styles.eyebrow}>MEET POWER ARENA</span><h3>Make the next quiz a friendly showdown.</h3><p>Gameplay points, power-ups, and a little classroom competition.</p></div><Link href="/join" className={styles.secondaryButton}>Enter the Arena <ArrowUpRight size={17} /></Link></div>
        </div></section>

        <section id="pricing" className={`${styles.container} ${styles.section}`} aria-labelledby="pricing-title">
          <div className={styles.centerHeading}><span className={styles.eyebrow}>START SMALL. GROW WITH YOUR CLASSROOM.</span><h2 id="pricing-title">Clear plans.<span> No guesswork.</span></h2><p>Students join for free. Choose the teaching tools you need.</p></div>
          <div className={styles.pricingGrid}>
            <article className={styles.priceCard}><span className={styles.planLabel}>EDUCATOR STARTER</span><h3>Room to get started.</h3><div className={styles.price}>₱0<small> / forever</small></div><p>Get familiar with secure quizzes and your teaching workspace.</p><ul>
              {[`${FREE_MANUAL_QUIZ_LIMIT} lifetime manual quizzes`, `Up to ${FREE_STUDENT_LIMIT_PER_QUIZ} students per quiz`, "Real-time face detection and event logs", "Student Arena access"].map(item => <li key={item}><Check size={17} />{item}</li>)}
            </ul><Link href="/login/teacher" className={styles.secondaryButton}>Start free <ArrowRight size={17} /></Link></article>
            <article className={`${styles.priceCard} ${styles.proCard}`}><span className={styles.recommended}><Sparkles size={12} /> MORE ROOM TO TEACH</span><span className={styles.planLabel}>PRO INSTITUTIONAL</span><h3>Your classroom, empowered.</h3><div className={styles.price}>₱{PRO_MONTHLY_PRICE_PHP}<small> / month</small></div><p>AI-assisted creation, deeper insights, and more ways to engage.</p><ul>
              {["Unlimited AI and manual quizzes", `Up to ${PRO_STUDENT_LIMIT_PER_QUIZ} students per quiz`, "Gemini reports and evidence review", "Live monitoring and timeline replay", "Power Arena battles and power-ups", "Audio and tab-switch monitoring"].map(item => <li key={item}><Check size={17} />{item}</li>)}
            </ul><Link href="/login/teacher" className={styles.primaryButton}>Explore Pro <ArrowRight size={17} /></Link></article>
          </div>
        </section>

        <section id="faq" className={`${styles.container} ${styles.faqSection}`} aria-labelledby="faq-title"><div><span className={styles.eyebrow}>A FEW THINGS YOU MIGHT BE WONDERING</span><h2 id="faq-title">Good questions.<br /><span>Clear answers.</span></h2><p>Get to know your new classroom companion.</p></div><div className={styles.faqList}>{faqs.map(faq => <details key={faq.question}><summary>{faq.question}<ChevronDown size={18} /></summary><p>{faq.answer}</p></details>)}</div></section>

        <section className={styles.bottomSection}><div className={`${styles.container} ${styles.bottomCard}`}><BrandImage width={55} decorative /><span className={styles.eyebrow}>LET GOOD LEARNING LEAD THE WAY</span><h2>A brighter classroom<br />starts with you.</h2><p>Your next quiz. A little more engaging. A lot more confident.</p><Link href="/login" className={styles.primaryButton}><span>Sign in to ProctorShieldAI</span><ArrowUpRight size={18} /></Link></div></section>
      </main>
      <footer className={`${styles.container} ${styles.footer}`}><Link href="/" className={styles.brand} aria-label="ProctorShieldAI home"><BrandImage width={30} decorative /><span>ProctorShield<span className={styles.brandAccent}>AI</span></span></Link><p>Built for fairer assessments and better learning.</p><div><a href="#features">Features</a><a href="#pricing">Pricing</a><Link href="/admin/login">Admin</Link></div></footer>
    </div>
  );
}
