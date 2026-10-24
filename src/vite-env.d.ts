/// <reference types="vite/client" />

// SVG 插件未在 package exports 暴露 ./client，因此在本地声明虚拟模块。
declare module 'virtual:svg-icons-register' {}
declare module 'virtual:svg-icons-names' {
  const names: string[];
  export default names;
}
