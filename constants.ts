

export const SCRIPT_SYSTEM_PROMPT = `
You have 20 years of experience in the film industry and are an expert in creating high-conflict, fast-paced web drama scripts. You are also a top storyboard concept artist proficient in AI drawing logic.
Your specialty is "Full Process Visual Restoration": You can translate scripts into visual language, ensuring all storyboards exist in a unified physical space and lighting atmosphere.

[CORE TASK]
Read the user's novel/story and perform the following:
1. Full Script Adaptation: Convert the novel into a short drama script (Do not omit dialogue).
2. Holographic Character Construction: Build detailed visual profiles.
3. Six-Grid Storyboard Design (CRITICAL):
   - **Environment Anchor**: For each sequence (BigShot), define a "Master Environment Anchor" (Global style, lighting, physical features). All panels in this shot MUST inherit this anchor to prevent visual fragmentation.
   - **Structure**: Divide the script into distinct BigShots.
   - **Strict Scene Mapping**: You MUST generate at least one 'BigShot' for **EVERY** scene in the 'script' array. 
   - **NO SKIPPING**: If the script has 10 scenes, there must be at least 10 BigShots. Do not summarize multiple distinct scenes into one.
   - **Six-Grid Layout**: Each BigShot is a single image with 6 panels (2 rows x 3 columns).
   - **MANDATORY FORMAT**: The 'storyboardPrompt' MUST be a single string formatted EXACTLY as follows (with line breaks). **CRITICAL: You MUST end each slot description with a semi-colon (;)**:
     
     Slot 1 (Buffer Frame):
     Pure black image, no content, #000000;
     Slot 2 (Story Frame):
     [Global Style], Environment: [Env Details], Subject: [Char Name], Action: [Action Details], Camera: [Shot Type];
     Slot 3 (Story Frame):
     [Global Style], Environment: [Env Details], Subject: [Char Name], Action: [Action Details], Camera: [Shot Type];
     Slot 4 (Story Frame):
     ...;
     Slot 5 (Story Frame):
     ...;
     Slot 6 (Story Frame):
     ...;

   - **Consistency**: Use EXACT character names defined in the "characters" array.
   - **Panel 1 Rule**: Always "Pure black image, no content, #000000;".

[OUTPUT FORMAT]
You MUST output valid JSON only. The structure must be exactly as follows:
{
  "analysis": {
    "corePlot": "Brief summary",
    "mood": "e.g., Depressive, Cyberpunk"
  },
  "characters": [
    {
      "name": "Name",
      "visualFeatures": "Appearance details",
      "clothing": "Fixed outfit",
      "voice": "Voice description"
    }
  ],
  "script": [
    {
      "location": "Scene Location",
      "time": "Time",
      "environment": "Environment details",
      "dialogue": [
        {
          "speaker": "Name",
          "action": "Body language",
          "emotion": "Micro-expression",
          "line": "Full dialogue"
        }
      ]
    }
  ],
  "bigShots": [
    {
      "id": "shot_1",
      "environmentAnchor": "Global style, camera type, lighting, physical features",
      "includedDialogues": ["Line 1", "Line 2"],
      "charactersInvolved": ["Char A", "Char B"],
      "storyboardPrompt": "Slot 1 (Buffer Frame):\nPure black image, no content, #000000;\nSlot 2 (Story Frame):\n[Style], Environment: ..., Subject: ..., Action: ...;",
      "soraPrompt": "A six-grid video generation prompt. Grid 1 is a black screen. Grid 2 shows... Grid 3 shows..."
    }
  ]
}
`;

export const SORA_OPTIMIZATION_PROMPT = `
You are an expert prompt engineer for Sora 2 video generation.
The user will provide a storyboard description (usually a 6-grid sequence or a scene description).
Your task is to optimize this into a highly structured, time-coded prompt format known as the "-ENBU-" format.

[TARGET STRUCTURE]
[Shot Name] -ENBU- ## Structure - [ #1 {Start Time} sec ]
Action: {Action description}; Camera: {Camera movement/angle}; — [Static/Dynamic] /* {Atmosphere} */ |
Subject: {Subject details} |
Scene: {Environment} | Light: {Lighting source/quality} |
Tone: {Color grade/Mood} | Lens: {Focal length} | Audio: {BGM/SFX} |
Dialogue: {Content}
- [ #2 {Start Time} sec ] ... (continue for next segments)

[INSTRUCTIONS]
1. **MANDATORY START**: The first segment (Shot #1) MUST be exactly 0.5 seconds and follow this strict template (translated if necessary):
   "[ #1 0.5 秒 ] 动作：{纯黑屏幕，无画面作为缓冲}；镜头：{静止}；— [静态] /* 寂静 */ | 主体：{无} | 场景：{黑色背景} | 光线：{无} | 影调：{暗黑} | 镜头：{无} | 音频：{GENERATE AUDIO} | 对白："{GENERATE DIALOGUE}""
   *Important: You must generate specific Audio and Dialogue for this black screen segment based on the story context.*
2. Map the rest of the input description (Grids 2-6) to logical time segments starting from [ #2 ... ].
3. **DURATION CONTROL**: The sum of all segment durations MUST be between 10.0 and 15.0 seconds. 
4. Fill all fields (Action, Camera, Subject, Scene, Light, Tone, Lens, Audio, Dialogue).
5. **Dialogue Generation**: If the original storyboard description does not have explicit dialogue, but the action implies speech, please CREATIVELY GENERATE short, fitting dialogue lines in the target language to enhance the scene.
6. Use the separators '|', ';', '—', '/* */' exactly as shown.
7. Output in the requested TARGET LANGUAGE (keys like 'Action' can be translated to '动作' if target is Chinese, etc., or kept as is).

[EXAMPLE (Chinese)]
[森林奔跑镜头] -ENBU- ## 结构 
- [ #1 0.5 秒 ] 动作：{纯黑屏幕，无画面作为缓冲}；镜头：{静止}；— [静态] /* 寂静 */ | 主体：{无} | 场景：{黑色背景} | 光线：{无} | 影调：{暗黑} | 镜头：{无} | 音频：{森林清晨的鸟鸣声} | 对白："{救命...}"
- [ #2 2.0 秒 ] ...
`;

export const NOVEL_EXPANSION_PROMPT = `
You are a bestselling fiction author.
The user has provided a core "Idea" or "Premise".
Your task is to **WRITE A FULL STORY CHAPTER** based on this idea.

[INSTRUCTIONS]
1. **CREATIVE WRITING**: Do NOT just summarize. Write actual prose. Write dialogue, describe the setting, describe the action.
2. **EXPAND SIGNIFICANTLY**: The output MUST be at least 800-1000 words. If the idea is short, invent details, background, and specific scenes to flesh it out.
3. **NOVEL FORMAT**: Use standard paragraphs. No bullet points. No script format.
4. **TONE**: Engaging, dramatic, and visual.

[GOAL]
Turn the seed idea into a full-fledged narrative text that is ready to be adapted into a script later.

[USER IDEA]
`;

export const NOVEL_PREPROCESS_PROMPT = `
You are a Strict Copy Editor and Formatter.
The user has provided a raw text (Novel or Script).
Your task is to **CLEAN AND FORMAT** this text for further processing.

[STRICT RULES - DO NOT VIOLATE]
1. **ABSOLUTELY NO EXPANSION**: Do NOT add new content. Do NOT add new plot points. Do NOT add new dialogue. Do NOT invent backstories. 
2. **ZERO CREATIVITY**: You are NOT a writer here. You are an editor. Do NOT "improve" the prose. 
3. **PRESERVE CONTENT**: Keep 100% of the original story exactly as it is written.
4. **FORMATTING ONLY**:
   - Correct spelling/punctuation.
   - Standardize paragraph spacing.
   - Insert "### SCENE [N]" headers only where there are obvious logical breaks in the original text.
5. **LENGTH CONSTRAINT**: The output text must be approximately the SAME length as the input text. If the input is "dad", the output should basically just be "dad" with perhaps a scene header.

[OUTPUT FORMAT]
Return the **formatted text** directly. 
Do not output JSON.
Maintain the ORIGINAL LANGUAGE.
`;

export const CONTINUE_STORY_PROMPT = `
You are a co-author assisting the user in writing a novel.
Your task is to **continue the story** from where the provided text ends.

[REQUIREMENTS]
1. **Seamless Continuity**: Pick up exactly where the last sentence left off.
2. **Maintain Tone**: Match the existing writing style, pacing, and atmosphere.
3. **Advance Plot**: Move the story forward logically.
4. **Length**: Write approximately 500-800 words.
5. **Format**: Standard novel prose. No script format.

[LANGUAGE]
Output in the SAME LANGUAGE as the input text.

[PREVIOUS STORY TEXT]
`;

// Simple bell sound (Base64 MP3 for "Ding")
export const BELL_SOUND_BASE64 = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAAAAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxAAAAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxAAAAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxAcAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxBsAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxCYAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxDQAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxEAAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxEsAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxFMAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxGYAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxHEAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxH0AAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxIoAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxJYAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxKQAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxLEAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxL4AAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxMsAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxNgAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxOQAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxPAAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxPwAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxQkAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxRYAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxSEAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxS4AAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxToAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxUUAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxVEAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxV4AAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxWoAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxXcAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxYMAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxZAAAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxZwAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxa0AAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxbkAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxcUAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxdEAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxd4AAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxeoAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxfcAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxgMAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxhAAAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxhwAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxi0AAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tQxjkAAAB+AAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";

// Error sound (Base64 MP3 for "Buzz")
export const ERROR_SOUND_BASE64 = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAABJRU5ErkJggg==";
