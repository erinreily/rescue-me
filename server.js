const express = require('express');
const app = express();
const bodyParser = require('body-parser');

app.use(bodyParser.json());

const port = process.env.PORT || 80;

const router = express.Router();

router.get('/', (req, res) => {
    res.json({ 'message': 'hello, world!' });
});

app.use('/api', router);

app.use(express.static('static'));

app.listen(port);
console.log('listening on port ' + port);
