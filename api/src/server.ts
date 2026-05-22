import app from './app';
import logger from './lib/logger';

const PORT = 3000;
app.listen(PORT, () => {
  logger.info(`FlowBoard API running at http://localhost:${PORT}`);
});