const express = require("express");
const userRoutes = require('./routes/user');

const app = express();
const PORT = 4000;

app.get("/", (req, res) => {
  res.send("Hello from Express!");
});
app.use('/api/user', userRoutes);

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});