import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // Em desenvolvimento, o Vite repassa /api para o backend: o navegador vê uma origem só,
    // como no Docker com o nginx, e o cookie SameSite=Strict funciona igual.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
