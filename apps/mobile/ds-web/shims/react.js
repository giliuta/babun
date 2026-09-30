// React берётся у страницы (window.React): рендерит карточки и дизайны
// Claude Design именно он, и второй экземпляр React сломал бы хуки.
module.exports = window.React;
