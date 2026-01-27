# DramaForge AI

<div align="center">

**One-stop AI Short Drama Platform**

Integrating Gemini, Nanobanana, and Sora 2 for automated script-to-video generation

[![React](https://img.shields.io/badge/React-19.2.3-blue.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.2-purple.svg)](https://vitejs.dev/)

</div>

## Features

- **Script Generation**: Generate professional drama scripts from novels or creative ideas using Google Gemini AI
- **Character Design**: Create detailed character reference sheets with three-view designs using Nanobanana API
- **Storyboarding**: Generate 6-grid storyboards for each scene
- **Video Generation**: Produce high-quality videos using Sora 2 API
- **Multiple Art Styles**: Animation (2D), Cinematic Realistic, Cyberpunk, Watercolor, 3D Cartoon
- **Multi-language Support**: Chinese (Simplified), English, Japanese, Korean
- **Dual Modes**: 
  - Auto mode: Fully automated pipeline from input to video
  - Manual mode: Step-by-step control with editing capabilities
- **Real-time Progress Tracking**: Monitor generation status at each stage
- **Interactive Editing**: Modify prompts, regenerate scenes, and adjust character assignments

## Tech Stack

- **Frontend**: React 19.2.3 + TypeScript
- **Build Tool**: Vite 6.2
- **AI Services**:
  - Google Gemini 3 Pro (Script generation & optimization)
  - Nanobanana API (Character design & storyboard generation)
  - Sora 2 API (Video generation)
- **HTTP Client**: Axios
- **Icons**: Lucide React

## Installation

**Prerequisites**: Node.js (v18 or higher recommended)

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/dramaforge-ai.git
   cd dramaforge-ai
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure API Keys:
   - Launch the application and click the API key configuration button
   - Enter your API keys for:
     - Google Gemini API
     - Nanobanana API
     - Sora API
   - Optionally configure custom base URLs if using proxy services

4. Run the development server:
   ```bash
   npm run dev
   ```

5. Open your browser and navigate to `http://localhost:5173`

## Usage

### Creating a New Task

1. Click the "New Task" button
2. Choose input type:
   - **Novel**: Paste your novel text
   - **Idea**: Enter a creative idea (will be expanded into a story)
3. Select art style and language
4. Choose mode (Auto or Manual)
5. Click "Create" to start the generation pipeline

### Pipeline Stages

The application follows these logical steps:

1. **Preprocessing**: Segment and analyze the input text
2. **Script Generation**: Convert text into structured script scenes
3. **Character Design**: Generate character reference sheets
4. **Storyboarding**: Create 6-grid storyboards for each scene
5. **Prompt Optimization**: Optimize prompts for Sora video generation
6. **Video Generation**: Produce final videos for each scene
7. **Completion**: All assets ready for export

### Manual Mode Features

In manual mode, you can:
- Edit character information and regenerate designs
- Modify storyboard prompts and regenerate images
- Adjust Sora prompts and regenerate videos
- Assign characters to specific scenes
- Download individual assets (images, videos)

### Exporting

- Download storyboards as PNG images
- Download videos as MP4 files
- Export character design sheets

## Project Structure

```
dramaforge-ai/
├── components/           # React components
│   ├── ApiKeyModal.tsx
│   ├── ConfirmModal.tsx
│   ├── EditCharacterModal.tsx
│   ├── ImageLightbox.tsx
│   ├── NewTaskModal.tsx
│   └── TaskCard.tsx
├── services/           # API service layers
│   ├── geminiService.ts      # Gemini AI integration
│   ├── mediaService.ts       # Nanobanana & Sora integration
│   └── mockExternalServices.ts
├── App.tsx             # Main application component
├── types.ts            # TypeScript type definitions
├── constants.ts        # Constants and prompts
├── locales.ts          # Internationalization
├── index.html
├── index.tsx
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## API Configuration

### Gemini API
- Model: `gemini-3-pro-preview`
- Used for: Script generation, prompt optimization, story expansion, preprocessing
- Get API key: https://ai.google.dev/

### Nanobanana API
- Used for: Character design generation, storyboard generation
- Supports: Text-to-Image and Image-to-Image
- Get API key: https://nanobanana.com/

### Sora API
- Used for: Final video generation
- Get API key: https://openai.com/sora

## Development

### Available Scripts

```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run preview  # Preview production build
```

### Building for Production

```bash
npm run build
```

The built files will be in the `dist` directory.

## Features in Detail

### Script Generation
- Converts novels or ideas into structured scripts with dialogue, actions, and emotions
- Analyzes plot, mood, and character relationships
- Supports long-form text with automatic segmentation

### Character Design
- Generates three-view character sheets (front, side, back)
- Supports image-to-image generation from user-uploaded references
- Consistent character appearance across scenes

### Storyboarding
- Creates 6-grid storyboards for each scene
- Visualizes camera angles, character positions, and environment
- Editable prompts for regeneration

### Video Generation
- Uses optimized prompts for best results
- Real-time progress tracking
- Retry mechanism for failed generations

## Browser Support

- Chrome/Edge (recommended)
- Firefox
- Safari


## Contributing

This is a private project. For inquiries, please contact the project maintainers.

## Acknowledgments

- Google Gemini AI for script generation capabilities
- Nanobanana API for image generation services
- Sora API for video generation
- Lucide React for beautiful icons
