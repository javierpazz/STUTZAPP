import express from 'express';
import expressAsyncHandler from 'express-async-handler';
import Invoice from '../models/invoiceModel.js';
import Receipt from '../models/receiptModel.js';
import User from '../models/userModel.js';
import Product from '../models/productModel.js';
import { isAuth, isAdmin, mailgun, payOrderEmailTemplate } from '../utils.js';

const orderRouter = express.Router();

orderRouter.get(
  '/',
  isAuth,
  isAdmin,
  expressAsyncHandler(async (req, res) => {
    const orders = await Invoice.find().populate('user', 'name');
    res.send(orders);
  })
);

const PAGE_SIZE = 10;

orderRouter.get(
  '/admin',
  isAuth,
  isAdmin,
  expressAsyncHandler(async (req, res) => {
    const { query } = req;
    const page = query.page || 1;
    const pageSize = query.pageSize || PAGE_SIZE;

    const orders = await Invoice.find({ ordYes: 'Y' })
      .populate('user', 'name')
      .skip(pageSize * (page - 1))
      .limit(pageSize);
    const countOrders = await Invoice.countDocuments({
      ordYes: 'Y',
    });
    res.send({
      orders,
      countOrders,
      page,
      pages: Math.ceil(countOrders / pageSize),
    });
  })
);

orderRouter.post(
  '/',
  isAuth,
  expressAsyncHandler(async (req, res) => {
    const newOrder = new Invoice({
      invoiceItems: req.body.invoiceItems.map((x) => ({
        ...x,
        product: x._id,
      })),
      shippingAddress: req.body.shippingAddress,
      paymentMethod: req.body.paymentMethod,
      itemsPrice: req.body.itemsPrice,
      shippingPrice: req.body.shippingPrice,
      taxPrice: req.body.taxPrice,
      totalPrice: req.body.totalPrice,
      user: req.user._id,
      ordYes: req.body.ordYes,
      staOrd: req.body.staOrd,
    });

    const order = await newOrder.save();
    res.status(201).send({ message: 'New Order Created', order });
  })
);

orderRouter.get(
  '/summary',
  isAuth,
  isAdmin,
  expressAsyncHandler(async (req, res) => {
    const producIO = await Invoice.aggregate([
      { $unwind: '$invoiceItems' },

      {
        $set: {
          salio1: {
            $cond: [{ $eq: ['$salbuy', 'SALE'] }, '$invoiceItems.quantity', 0],
          },
          entro1: {
            $cond: [{ $eq: ['$salbuy', 'BUY'] }, '$invoiceItems.quantity', 0],
          },
        },
      },
      {
        $group: {
          _id: '$invoiceItems.name',
          salio: { $sum: '$salio1' },
          entro: { $sum: '$entro1' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    /////////////////////////////////////////////////////////
    const factura = 'SALE';
    const invoices = await Invoice.find();

    const ctacte = await Receipt.aggregate([
      //      {
      //        $match: {
      //          salbuy: factura,
      //        },
      ////      },
      {
        $set: {
          docDat: '$recDat',
          importeRec: '$totalPrice',
          importeRecB: '$totalBuy',
        },
      },
      {
        $unionWith: {
          coll: 'invoices',
          pipeline: [
            //            {
            //              $match: {
            //                salbuy: factura,
            //              },
            //            },
            {
              $set: {
                docDat: '$invDat',
                importeInv: '$totalPrice',
                importeInvB: '$totalBuy',
              },
            },
          ],
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$docDat' } },
          salesS: { $sum: '$importeInv' },
          inputsS: { $sum: '$importeRec' },
          salesB: { $sum: '$importeInvB' },
          inputsB: { $sum: '$importeRecB' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    //      res.send(ctacte);
    /////////////////////////////////////////////////////////

    const orders = await Invoice.aggregate([
      {
        $group: {
          _id: null,
          numOrders: { $sum: 1 },
          totalSales: { $sum: '$totalPrice' },
        },
      },
    ]);
    const users = await User.aggregate([
      {
        $group: {
          _id: null,
          numUsers: { $sum: 1 },
        },
      },
    ]);
    const dailyOrders = await Invoice.aggregate([
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$invDat' } },
          orders: { $sum: 1 },
          sales: { $sum: '$totalPrice' },
          buys: { $sum: '$totalBuy' },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    const dailyMoney = await Receipt.aggregate([
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$recDat' } },
          inputs: { $sum: '$totalPrice' },
          outputs: { $sum: '$totalBuy' },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    const productCategories = await Product.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
        },
      },
    ]);
    res.send({
      producIO,
      ctacte,
      users,
      orders,
      dailyOrders,
      dailyMoney,
      productCategories,
    });
  })
);

orderRouter.get(
  '/mine',
  isAuth,
  expressAsyncHandler(async (req, res) => {
    const { query } = req;
    const page = query.page || 1;
    const pageSize = query.pageSize || PAGE_SIZE;

    const orders = await Invoice.find({ user: req.user._id })
      .skip(pageSize * (page - 1))
      .limit(pageSize);
    const countOrders = await Invoice.countDocuments();

    res.send({
      orders,
      countOrders,
      page,
      pages: Math.ceil(countOrders / pageSize),
    });
  })
);

orderRouter.get(
  '/:id',
  isAuth,
  expressAsyncHandler(async (req, res) => {
    const order = await Invoice.findById(req.params.id).populate(
      'user',
      'name'
    );
    if (order) {
      res.send(order);
    } else {
      res.status(404).send({ message: 'Order Not Found' });
    }
  })
);

orderRouter.put(
  '/:id/deliver',
  isAuth,
  expressAsyncHandler(async (req, res) => {
    const order = await Invoice.findById(req.params.id);
    if (order) {
      order.isDelivered = true;
      order.deliveredAt = Date.now();
      await order.save();
      res.send({ message: 'Order Delivered' });
    } else {
      res.status(404).send({ message: 'Order Not Found' });
    }
  })
);

orderRouter.put(
  '/:id/pay',
  isAuth,
  expressAsyncHandler(async (req, res) => {
    const order = await Invoice.findById(req.params.id).populate(
      'user',
      'email name'
    );
    if (order) {
      order.isPaid = true;
      order.paidAt = Date.now();
      order.paymentResult = {
        id: req.body.id,
        status: req.body.status,
        update_time: req.body.update_time,
        email_address: req.body.email_address,
      };

      const updatedOrder = await order.save();
      mailgun()
        .messages()
        .send(
          {
            from: 'Amazona <amazona@mg.yourdomain.com>',
            to: `${order.user.name} <${order.user.email}>`,
            subject: `New order ${order._id}`,
            html: payOrderEmailTemplate(order),
          },
          (error, body) => {
            if (error) {
              console.log(error);
            } else {
              console.log(body);
            }
          }
        );

      res.send({ message: 'Order Paid', order: updatedOrder });
    } else {
      res.status(404).send({ message: 'Order Not Found' });
    }
  })
);

orderRouter.delete(
  '/:id',
  isAuth,
  isAdmin,
  expressAsyncHandler(async (req, res) => {
    const order = await Invoice.findById(req.params.id);
    if (order) {
      await order.remove();
      res.send({ message: 'Order Deleted' });
    } else {
      res.status(404).send({ message: 'Order Not Found' });
    }
  })
);

export default orderRouter;
