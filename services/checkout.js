var config = require('../env/index');
var SubscriptionsService = require('../services/subscriptions');
var Transactions = require('../services/transactions');
var CustomersService = require('../services/customers');
var Liqpay = require('../liqpay/index');
var Stripe = require('stripe')(config.stripe.token);
var async = require('async');
var moment = require('moment');
var request = require('request');
var logger = require('../modules/logger').api;
var debug = require('debug')('billing');

var liqpayPubKey = config.liqpay.publickey;
var liqpayPrivKey = config.liqpay.privatekey;
var liqpay = new Liqpay(liqpayPubKey, liqpayPrivKey);

module.exports = {
	balance: balanceCheckout,
	stripe: stripeCheckout,
	liqpay: liqpayCheckout,
	liqpayCheckoutResult: liqpayCheckoutResult,
	handleOrder: handleOrder
};

function getStatusName(string) {
	var status = null;
	switch(string) {
		case 'succeeded':
			status = 'success';
			break;
		case 'pending':
			status = 'pending';
			break;
		case 'failed':
			status = 'failed';
			break;
	}

	return status || string;
}

function balanceCheckout(paymentParams, callback) {
	handleOrder(paymentParams.customerId, paymentParams.order, function (err){
		if(err) return callback(err);
		callback({ success: true });
	});
}

function stripeCheckout(params, callback) {
	debug('stripeCheckout: ', params);
	var transaction = {};

	var promise = Stripe.charges.create({
		amount: params.amount,
		currency: params.currency.toLowerCase(),
		customer: params.serviceParams.serviceCustomer
	});

	if(!callback) return promise;

	promise.then(function(charge) {
		transaction = {
			transaction_id: charge.id,
			amount: charge.amount,
			currency: charge.currency,
			serviceStatus: charge.status,
			status: getStatusName(charge.status)
		};

		callback(null, transaction);
	}).catch(function(err) {
		callback(null, { error: { message: err } });
	});
}

function liqpayCheckout(params, callback) {
	var signature, sigData, locationHeader;
	var paymentParams = {
		amount: params.amount,
		currency: params.amount,
		description: params.description,
		order_id: params.order_id,
		language: params.language,
		public_key: liqpayPubKey,
		server_url: config.liqpay.serverUrl + '?id=' + params.customerId,
		result_url: params.resultUrl || config.liqpay.resultUrl,
		paymentMethod: 'card',
		action: 'pay',
		version: 3,
		sandbox: 1
	};

	debug('liqpay params: ', paymentParams);

	signature = liqpay.cnb_signature(paymentParams);
	sigData = new Buffer(JSON.stringify(paymentParams)).toString('base64');

	// debug('liqpay signature: ', signature, sigData);

	request.post('https://www.liqpay.com/api/3/checkout', {form: {data: sigData, signature: signature}}, function (err, r, result){
		if(err){
			debug('liqpay error: ', err);
			return callback(err);
		}

		locationHeader = r.headers['Location'] ? 'Location' : 'location';
		
		if(r.statusCode === 302 || r.statusCode === 303) {

			callback(null, {
				success: true,
				redirect: r.headers[locationHeader]
			});

		} else {
			callback(null, {
				success: false,
				message: 'CHECKOUT_STATUS'
			});
		}

	});
}

function liqpayCheckoutResult(data, callback){

	CustomersService.updateBalance(data.customerId, data.amount)
	.then(function (customer){
		debug('Update customer balance: ', err, customer.balance);
		
		Transactions.get({ customerId: data.customerId, order_id: data.order_id }, function(err, transactions){
			if(err) return logger.error(err);
			if(!transactions.length) return;

			async.each(transactions, function(transaction, cb) {

				if(transaction.status !== data.status && (data.status === 'success' || data.status === 'sandbox')){
					
					if(transaction.order) {
						debug('transaction.order: ', transaction.order);

						handleOrder(customerId, transaction.order, function (err){
							if(err) {
								//TODO - handle the error
								// debug('handleOrder error: ', err);
								return logger.error(err);
							}
							//TODO - log the event
							debug('Order handled!');
						});
					}

					// data.balance = customer.balance;

					Transactions.update({ _id: transaction._id }, { balance: customer.balance }, function (err, transaction){
						if(err) logger.error('transaction update error: %o', err);
						else debug('Transaction updated: ', transaction.status, transaction);
					});

				}

				cb();

			}, function(err) {
				if(err) return callback(err);
				callback();
			});

		});

	})
	.catch(function(err) {
		logger.error('Update customer balance error: %o', err);
		if(err) return callback(err);
	});

}

function handleOrder(customerId, order, callback){

	//remove this line to handle multiple orders
	// if(order.length > 1) return callback('INVALID_ACTION');

	var allowedActions = ['renewSubscription', 'createSubscription', 'updateSubscription', 'changePlan'];

	async.eachSeries(order, function (item, cb){

		if(!item.data) return cb();

		item.data.customerId = customerId;

		debug('handleOrder params: %o', item);

		if(item.action && allowedActions.indexOf(item.action) !== -1) {
			SubscriptionsService[item.action](item.data, function(err, result) {
				if(err) {
					debug('handleOrder error: ', err);
					return cb(err);
				}
				cb();
			});
		} else {
			cb('INVALID_ACTION');
		}

	}, function (err){
		if(err) {
			logger.error(err);
			return callback(err);
		} else {
			callback();
			//TODO - log the event
		}
	});

}