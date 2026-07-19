import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        sk: {
          red: 'rgba(129,6,2,1)',
          slate: 'rgba(128,143,180,1)',
        },
      },
    },
  },
  plugins: [],
};

export default config;
