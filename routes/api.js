var express = require('express');
var router = express.Router();
var checkoutCtrl = require('../controllers/checkout');
var debug = require('debug')('billing');

module.exports = router;

/****************************************
*			Unauthorized zone				*
*****************************************/

/*** Checkout Result Routes ***/
router.post('/checkoutResult', checkoutCtrl.checkoutResult);