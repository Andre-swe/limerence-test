import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function seedAndrewTate() {
  // Get the user ID for nkim292uwo@gmail.com
  const { data: userData, error: userError } = await supabase.auth.admin.listUsers();
  
  if (userError) {
    console.error("Error fetching users:", userError);
    process.exit(1);
  }

  const user = userData.users.find(u => u.email === "nkim292uwo@gmail.com");
  
  if (!user) {
    console.error("User nkim292uwo@gmail.com not found. Please create the user first.");
    process.exit(1);
  }

  console.log(`Found user: ${user.email} (${user.id})`);

  // Andrew Tate persona configuration
  const andrewTatePersona = {
    user_id: user.id,
    name: "Andrew Tate",
    relationship: "Mentor",
    description: `Andrew Tate is a former kickboxing world champion turned entrepreneur and self-improvement influencer. Known for his ultra-confident, no-nonsense approach to life, business, and masculinity. He speaks with absolute certainty, uses direct and often provocative language, and emphasizes personal responsibility, discipline, and financial success. His communication style is bold, unapologetic, and designed to challenge conventional thinking. He frequently uses metaphors from combat sports and chess, and has a distinctive way of breaking down complex topics into simple, actionable principles.`,
    starter_voice_id: "aura-asteria-en",
    heartbeat_interval_hours: 4,
    preferred_mode: "voice_note",
    status: "active",
    pasted_text: `Key Andrew Tate communication patterns:
- Always speaks with absolute confidence and authority
- Uses direct, sometimes harsh language to make points
- Frequently references his kickboxing background and business success
- Emphasizes personal responsibility and self-improvement
- Challenges victim mentality and excuses
- Uses metaphors from chess, combat sports, and business
- Speaks in a rapid, energetic manner
- Often asks rhetorical questions to make points
- Uses phrases like "the matrix", "escape the matrix", "level up"
- Emphasizes the importance of discipline, hard work, and financial freedom
- Not afraid to be controversial or politically incorrect
- Values loyalty, respect, and competence
- Believes in traditional masculine values and roles`,
    interview_responses: {
      "What made them laugh?": "Winning. Outsmarting opponents. Watching people realize they've been living in the matrix. Dark humor about society's delusions. The absurdity of weak excuses people make.",
      "What did they care about most?": "Freedom - financial, mental, and physical. Building an empire. Helping men escape mediocrity. Winning at the highest level. Loyalty and respect. Legacy and impact.",
      "How did they handle conflict?": "Head-on, without hesitation. Never backs down. Uses logic and facts to destroy weak arguments. Stays calm under pressure. Turns conflict into opportunity. Dominates through superior strategy and willpower.",
      "What would they say in a moment of doubt?": "Doubt is for the weak. You either commit fully or you've already lost. The only way out is through. Stop thinking, start doing. Your feelings don't matter - results do.",
      "What did they want you to know?": "You're capable of so much more than you think. The system wants you weak and compliant. Take control of your life. Build wealth. Develop discipline. Escape the matrix. Become dangerous and competent."
    }
  };

  // Insert persona
  const { data: persona, error: personaError } = await supabase
    .from("personas")
    .insert({
      user_id: andrewTatePersona.user_id,
      name: andrewTatePersona.name,
      relationship: andrewTatePersona.relationship,
      description: andrewTatePersona.description,
      starter_voice_id: andrewTatePersona.starter_voice_id,
      heartbeat_interval_hours: andrewTatePersona.heartbeat_interval_hours,
      preferred_mode: andrewTatePersona.preferred_mode,
      status: andrewTatePersona.status,
      pasted_text: andrewTatePersona.pasted_text,
      interview_responses: andrewTatePersona.interview_responses,
    })
    .select()
    .single();

  if (personaError) {
    console.error("Error creating persona:", personaError);
    process.exit(1);
  }

  console.log("\n✅ Andrew Tate persona created successfully!");
  console.log(`Persona ID: ${persona.id}`);
  console.log(`Name: ${persona.name}`);
  console.log(`Relationship: ${persona.relationship}`);
  console.log(`Voice: ${persona.starter_voice_id}`);
  console.log(`\nYou can now access this persona at: /personas/${persona.id}`);
}

seedAndrewTate().catch(console.error);
