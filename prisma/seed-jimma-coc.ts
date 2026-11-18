import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';
import { validateBank } from '../src/modules/assessments/questions.js';

const csvPath =
  process.env.JIMMA_COC_CSV ??
  'C:/Users/HP/Downloads/exit_exam_59_questions_explained.csv';

if (existsSync('.env')) loadEnvFile('.env');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!existsSync(csvPath)) throw new Error(`CSV file not found: ${csvPath}`);

const db = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    connectionTimeoutMillis: 30000,
  }),
});

type CsvRow = {
  question: string;
  correctAnswer: string;
  whyCorrect: string;
  limitation: string;
};

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function deterministicId(key: string) {
  const hex = createHash('sha256').update(`learnova:jimma-coc:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function readRows(): CsvRow[] {
  const rows = parseCsv(readFileSync(csvPath, 'utf8'));
  const header = rows.shift() ?? [];
  const index = (name: string) => header.indexOf(name);
  const question = index('Question');
  const correctAnswer = index('Correct Answer / Concept');
  const whyCorrect = index('Why This Is Correct');
  const limitation = index('Verification / Limitation');
  if ([question, correctAnswer, whyCorrect, limitation].some((i) => i < 0))
    throw new Error('CSV is missing one or more required columns');
  return rows
    .filter((row) => row[question]?.trim())
    .map((row) => ({
      question: row[question].trim(),
      correctAnswer: row[correctAnswer]?.trim() || 'Answer not provided',
      whyCorrect: row[whyCorrect]?.trim() || '',
      limitation: row[limitation]?.trim() || '',
    }));
}

const rows = readRows();
if (rows.length !== 59)
  throw new Error(`Expected 59 CSV questions, found ${rows.length}`);

const optionSets: Record<number, string[]> = {
  1: ['Rods', 'Cones', 'Lens', 'Iris'],
  2: ['Microbial breakdown of organic pollutants', 'Screening and sedimentation', 'Chlorination', 'Increasing water hardness'],
  3: ['They are caused by pathogens and may be transmitted between hosts', 'They are all spread directly from person to person', 'They are caused only by bacteria', 'They cannot be prevented'],
  4: ['Mycobacterium leprae', 'Plasmodium falciparum', 'Treponema pallidum', 'Candida albicans'],
  5: ['The variables tend to increase together', 'The variables always have a causal relationship', 'The variables tend to move in opposite directions', 'The variables have no detectable relationship'],
  6: ['A person with blood group AB can receive AB red blood cells', 'A person with blood group O can routinely receive AB red blood cells', 'A person with blood group A can routinely receive AB red blood cells', 'Only a person with blood group B can receive AB red blood cells'],
  7: ['It develops knowledge, attitudes and skills for informed health decisions', 'It is only the one-way delivery of health facts', 'It guarantees behavior change in every person', 'It replaces the need for supportive health services'],
  8: ['Enamel, dentin and cementum', 'Pulp, nerves and blood vessels', 'Gingiva and periodontal ligament only', 'Saliva and oral mucosa'],
  9: ['Eutrophication', 'Biomagnification', 'Sedimentation', 'Desertification'],
  10: ['Endemic malaria', 'An epidemic', 'A pandemic', 'A sporadic outbreak only'],
  11: ['The labeled refrigerator range, commonly 2–8 °C', 'A warm room above 30 °C', 'A freezer below 0 °C', 'The refrigerator door regardless of temperature'],
  12: ['Drawing conclusions about a population from a sample', 'Only listing the observations in a sample', 'Storing research data', 'Selecting laboratory equipment'],
  13: ['Taste receptors for bitterness are distributed across the tongue', 'Bitterness is detected only at the back of the tongue', 'Bitterness is detected only at the tip of the tongue', 'The tongue has no receptors for bitterness'],
  14: ['Medicines should be used according to evidence and patient-specific guidance', 'All medicines are completely safe', 'A higher dose is always better', 'Medicines never cause adverse effects'],
  15: ['Providing energy and, through fiber, supporting bowel function', 'Providing antibodies as the main immune cells', 'Producing bile salts', 'Replacing all dietary proteins'],
  16: ['Complete the prescribed course and follow suspension storage and shaking instructions', 'Stop as soon as symptoms improve', 'Freeze every amoxicillin suspension', 'Keep the suspension indefinitely at room temperature'],
  17: ['Diabetes mellitus', 'Malaria', 'Tuberculosis', 'Measles'],
  18: ['A membrane-bound nucleus and membrane-bound organelles', 'The presence of DNA only', 'The presence of ribosomes only', 'The presence of a cell membrane only'],
  19: ['The first newborn stool, which is dark, sticky and greenish-black', 'A mature yellow milk stool', 'A respiratory secretion', 'A type of newborn urine'],
  20: ['Permanent sterilization such as vasectomy or tubal surgery', 'Condom use', 'Oral contraceptive pills', 'A contraceptive implant'],
  21: ['About 12–20 breaths per minute at rest', 'About 1–3 breaths per minute', 'About 40–60 breaths per minute', 'About 80–100 breaths per minute'],
  22: ['Immunoglobulin E (IgE)', 'Immunoglobulin A (IgA)', 'Immunoglobulin G (IgG)', 'Immunoglobulin M (IgM)'],
  23: ['Plasma cells derived from B lymphocytes', 'Red blood cells', 'Platelets', 'Neurons'],
  24: ['Influenza', 'Tuberculosis', 'Cholera', 'Malaria'],
  25: ['Carbon monoxide poisoning; move to fresh air and give urgent oxygen and medical care', 'Carbon dioxide poisoning; give oral fluids only', 'Food poisoning; induce vomiting', 'Heat exhaustion; give antibiotics immediately'],
  26: ['Prepare the body for exercise', 'Replace the need for hydration', 'Guarantee that injuries cannot occur', 'Eliminate the need for a cooldown'],
  27: ['Complementary foods alongside breast milk after about 6 months', 'Only water after 6 months', 'Exclusive breast milk until adulthood', 'Abruptly stop breastfeeding at 6 months'],
  28: ['Plasma or serum', 'Red blood cells only', 'Platelets only', 'Bone tissue'],
  29: ['A descriptive proportion or prevalence statistic', 'A p-value', 'An incidence rate calculated over time', 'Proof that COVID-19 caused the change'],
  30: ['Leukocytosis, often associated with infection or inflammation', 'A definite diagnosis of leukemia', 'A low platelet count', 'A normal immune response in every case'],
  31: ['Neutrophils and monocytes/macrophages', 'Red blood cells', 'Mature platelets', 'Most plasma proteins'],
  32: ['Pain receptors (nociceptors)', 'Touch receptors', 'Smell receptors', 'Some pressure receptors'],
  33: ['Pathogenicity', 'Virulence', 'Infectivity', 'Antibiotic resistance'],
  34: ['Humans', 'Cattle', 'Mosquitoes', 'Freshwater snails'],
  35: ['Empathy combined with professional composure', 'Indifference', 'Sympathy without education or support', 'Panic in front of the family'],
  36: ['Specified legal indications under Ethiopian law', 'Only when the pregnant person is dying', 'Without any legal conditions', 'Only for common infections'],
  37: ['Low-density lipoprotein (LDL)', 'High-density lipoprotein (HDL)', 'Very-low-density lipoprotein (VLDL)', 'Chylomicrons'],
  38: ['Fluid outside cells, including interstitial fluid and plasma', 'Fluid inside cells only', 'Fluid inside the nucleus only', 'Digestive fluid inside the stomach'],
  39: ['Negative chronotropic medicines, often beta-blockers', 'Atropine', 'Positive chronotropic medicines', 'Stimulants that increase sympathetic activity'],
  40: ['Vitamin A', 'Vitamin C', 'Vitamin D', 'Vitamin K'],
  41: ['Lipid solubility, molecular size, ionization and concentration gradient', 'Hair color and skin tone', 'Blood group alone', 'Body temperature alone'],
  42: ['Integrity, accountability, respect, competence and ethical conduct', 'Dishonesty and neglect', 'Discrimination and confidentiality breaches', 'Avoiding responsibility'],
  43: ['Thyroid parafollicular (C) cells', 'Parathyroid chief cells', 'Pancreatic beta cells', 'Adrenal cortex cells'],
  44: ['Both contain genetic material (nucleic acid)', 'Both have cellular ribosomes', 'Both have independent metabolism', 'Both are cellular organisms'],
  45: ['Cutting or biting food', 'Tearing food', 'Grinding food', 'Swallowing food'],
  46: ['Monocytes', 'Neutrophils', 'B lymphocytes', 'Platelets'],
  47: ['Gastrointestinal enzymes digest the insulin protein', 'Insulin is too strong to take orally', 'Insulin immediately becomes a vitamin', 'The stomach converts insulin into oxygen'],
  48: ['Conditions present at birth', 'Conditions that are always inherited', 'Conditions caused only by infection', 'Conditions that begin only in old age'],
  49: ['Sharing a meal or handshake does not prevent HIV transmission', 'Using sterile needles prevents blood exposure', 'Using condoms reduces sexual transmission risk', 'Taking appropriate prevention medicine can reduce risk'],
  50: ['A condom, diaphragm or cervical cap', 'An oral contraceptive pill', 'A contraceptive injection', 'A contraceptive implant'],
  51: ['Treponema pallidum', 'Neisseria gonorrhoeae', 'Chlamydia trachomatis', 'Mycobacterium tuberculosis'],
  52: ['Effective or assertive communication', 'Aggression', 'Silence alone', 'Avoiding every discussion'],
  53: ['Resilience and adaptive coping', 'Avoidance and denial', 'Ignoring symptoms', 'Blaming others'],
  54: ['Sodium (Na⁺)', 'Potassium (K⁺)', 'Phosphate', 'Magnesium'],
  55: ['HPV vaccination together with cervical screening', 'Antibiotics alone', 'Avoiding all calcium', 'Replacing screening with vaccination'],
  56: ['Acid produced by oral bacteria in dental biofilm', 'Worms in the teeth', 'Sugar alone without bacterial biofilm', 'Lack of sunlight alone'],
  57: ['Thymus', 'Bone marrow', 'Spleen', 'Pancreas'],
  58: ['A competent adult’s informed refusal must generally be respected', 'A clinician may always override a competent refusal', 'Family preference always overrides the patient', 'Autonomy applies only when treatment is successful'],
  59: ['The iris muscles, including the sphincter and dilator pupillae', 'The lens', 'The retina', 'The cornea'],
};

const questionOverrides: Record<number, string> = {
  3: 'Which statement best describes infectious diseases?',
  7: 'Which statement best describes health education?',
  13: 'How is bitterness best perceived on the tongue?',
  14: 'Which statement is a safe general principle about medicines?',
  17: 'Which of the following is a non-communicable disease?',
  24: 'Which of the following diseases is caused by a virus?',
  49: 'Which action does not prevent HIV transmission?',
};

const courseTitle = 'JIMMA COC FOR HEALTH STUDENTS';
const examTitle = 'JIMMA COC Exit Exam: 59 Questions';
const bank = rows.map((row, index) => ({
  id: `jimma-coc-q-${index + 1}`,
  type: 'MCQ',
  question: questionOverrides[index + 1] ?? row.question,
  points: 1,
  difficulty: 'MEDIUM',
  options: (optionSets[index + 1] ?? []).map((text, optionIndex) => ({
    id: String.fromCharCode(97 + optionIndex),
    text,
  })),
  correct: ['a'],
  explanation: [
    `Correct answer: ${optionSets[index + 1]?.[0] ?? row.correctAnswer}.`,
    row.whyCorrect,
    row.limitation,
  ]
    .filter(Boolean)
    .join(' '),
}));
validateBank(bank, true);

try {
  const instructor =
    (await db.user.findUnique({ where: { email: 'gemedaforwork@gmail.com' } })) ??
    (await db.user.findFirst({ where: { role: 'INSTRUCTOR', active: true }, orderBy: { created_at: 'asc' } }));
  if (!instructor) throw new Error('No active instructor account exists');

  const course = await db.course.upsert({
    where: { id: deterministicId('course') },
    create: {
      id: deterministicId('course'),
      instructor_id: instructor.id,
      title: courseTitle,
      description:
        'A 59-question preparation course for health students taking the Jimma COC exit examination. Each question includes a reference concept, explanation, and verification note.',
      category: 'Health Sciences',
      price_minor: 0,
      currency: 'ETB',
      published: true,
      visibility: 'PUBLIC',
    },
    update: {
      instructor_id: instructor.id,
      description:
        'A 59-question preparation course for health students taking the Jimma COC exit examination. Each question includes a reference concept, explanation, and verification note.',
      category: 'Health Sciences',
      price_minor: 0,
      currency: 'ETB',
      published: true,
      visibility: 'PUBLIC',
      archived_at: null,
    },
  });

  await db.lesson.upsert({
    where: { course_id_position: { course_id: course.id, position: 0 } },
    create: {
      id: deterministicId('lesson-intro'),
      course_id: course.id,
      title: 'How to use this COC question bank',
      chapter: 'Introduction',
      position: 0,
      kind: 'TEXT',
      preview: true,
      content:
        'This course contains 59 health-science exit-exam questions from the supplied CSV. The source did not include the original multiple-choice options, so the exam uses manually graded short answers. Review the reference concept and explanation after attempting each question.',
      status: 'PUBLISHED',
    },
    update: {
      title: 'How to use this COC question bank',
      chapter: 'Introduction',
      kind: 'TEXT',
      preview: true,
      content:
        'This course contains 59 health-science exit-exam questions from the supplied CSV. The source did not include the original multiple-choice options, so the exam uses manually graded short answers. Review the reference concept and explanation after attempting each question.',
      status: 'PUBLISHED',
    },
  });

  const existing = await db.assessment.findFirst({
    where: { course_id: course.id, title: examTitle },
    select: { id: true },
  });
  const assessmentData = {
    course_id: course.id,
    title: examTitle,
    kind: 'EXAM',
    prompt:
      'Answer each question in your own words. The reference concept and explanation are available to the instructor for manual review. The supplied source did not include the original answer options.',
    questions: [],
    question_bank: bank as Prisma.InputJsonValue,
    structured: true,
    published: true,
    chapter: 'Exit examination preparation',
    passing_percent: 60,
    review_policy: 'AFTER_SUBMISSION',
    randomize_questions: false,
    randomize_options: false,
    allow_navigation: true,
    allow_resume: true,
    practice: true,
    revision: 1,
    max_score: rows.length,
    max_attempts: 3,
    results_published: true,
    allow_files: false,
  };
  const assessment = existing
    ? await db.assessment.update({ where: { id: existing.id }, data: assessmentData })
    : await db.assessment.create({ data: { id: deterministicId('assessment'), ...assessmentData } });

  await db.auditLog.create({
    data: {
      action: 'COURSE_CONTENT_SEEDED',
      resource_type: 'COURSE',
      resource_id: course.id,
      description: 'Seeded JIMMA COC health-student question bank from CSV.',
      metadata: { source: csvPath, questions: rows.length, assessment_id: assessment.id } as Prisma.InputJsonValue,
    },
  });
  console.log(JSON.stringify({ courseId: course.id, assessmentId: assessment.id, questions: rows.length }));
} finally {
  await db.$disconnect();
}
