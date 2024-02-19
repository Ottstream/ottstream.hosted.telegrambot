const TelegramBot = require('node-telegram-bot-api');
const Calendar = require('telegram-inline-calendar');
const axios = require('axios');
const moment = require('moment');
const logger = require('../../utils/logger/logger');
const {
  telegramBotRepository,
  botMessagesRepository,
  userRepository,
  ottProviderConversationProviderRepository,
  calendarEventRepository,
} = require('../../repository');

const config = require('../../config');
const BroadcastService = require('../socket/broadcastService.service');

class TelegramBotService {
  constructor() {
    logger.info(`telebot bot inited`);
    this.bots = {};
  }

  async processTelegramWebhook(body) {
    logger.info(`telegramBotService:processTelegramWebhook()START time: ${new Date().getTime()} ms ${JSON.stringify(body)}`);

    if (body.disable) {
      await this.clearHistory(body);
      return;
    }
    // eslint-disable-next-line camelcase
    const { token, message, callback_query } = body;
    const text = message?.text;
    const data = callback_query?.data;
    const lastMessageId = message?.message_id || callback_query?.message.message_id;

    // eslint-disable-next-line camelcase
    const fromId = callback_query ? callback_query.from.id : message.from.id;
    // eslint-disable-next-line camelcase
    const chatId = callback_query ? callback_query?.message?.chat?.id : message?.chat?.id;

    const ottProvider = await ottProviderConversationProviderRepository.getList({
      'telegram.authToken': token,
    });
    const botId = `${ottProvider[0].providerId}-${token}`;
    let messages = await botMessagesRepository.getBotMessageByChatId(chatId);
    if (messages) {
      messages = await botMessagesRepository.getBotMessageByChatIdAndPushMessageId(chatId, lastMessageId);
    } else {
      messages = await botMessagesRepository.createBotMessage({ chatId, botId }, lastMessageId);
    }

    const botInfo = await TelegramBotService.getBotLocalInfo(botId);

    const userInfo = botInfo.users && botInfo.users[fromId] ? botInfo.users[fromId] : null;

    let user = null;
    if (userInfo && userInfo.login) user = await TelegramBotService.getUserInfo(+userInfo.login);

    if (userInfo && userInfo.login && userInfo.loggedIn && !user) {
      // eslint-disable-next-line camelcase
      await this.logicForLogout(callback_query || message, botId, 2);
      return;
    }
    if (text === '/start') {
      logger.info(`botId: ${botId}`);
      await this.logicForStart(message, botId);
    } else if (data === 'login') {
      await this.logicForLogin(callback_query, botId);
    } else if (text === '/logout' && user && !user.accessEnable) {
      await this.logicForLogout(message, botId);
    } else if (user && !user.accessEnable && !botInfo.users[fromId].loggedIn) {
      // eslint-disable-next-line no-unused-expressions, camelcase
      callback_query ? await this.logicForLogout(callback_query, botId, 1) : await this.logicForLogout(message, botId, 1);
      return;
    } else if (text === '/getapps' && userInfo && userInfo.loggedIn && user && user?.accessEnable) {
      await this.logicForGetApps(message, botId);
    } else {
      // eslint-disable-next-line no-unused-expressions, camelcase
      callback_query ? await this.callbacks(callback_query, botId) : await this.callbacks(message, botId);
    }
    logger.info(
      `telegramBotService:processTelegramWebhook()END time: ${new Date().getTime()} ms ${JSON.stringify(message)} ${botId}`
    );
    return botInfo;
  }

  async logicForStart(message, botId) {
    const { chat, from } = message;
    logger.info(`logicForStart: ${botId}`);
    const chatId = chat.id;
    let loggedIn = false;
    const botLocalInfo = await TelegramBotService.getBotLocalInfo(botId);
    const fromId = from.id;
    if (!botLocalInfo.users || !botLocalInfo.users[fromId]) {
      if (!botLocalInfo.users) botLocalInfo.users = {};
      botLocalInfo.users[fromId] = {
        loggedIn: false,
        fromId,
        chatId,
      };
      await TelegramBotService.updateBotLocalInfo(botId, botLocalInfo);
    } else {
      const userInfo = botLocalInfo.users[fromId];
      loggedIn = userInfo.loggedIn;
    }
    if (loggedIn) {
      botLocalInfo.users[fromId].state = null;
      botLocalInfo.users[fromId].chatId = chatId;

      await TelegramBotService.updateBotLocalInfo(botId, botLocalInfo);
      logger.info(`send to bot ${JSON.stringify(moment().format())}`);
      await this.sendMessage(botId, chatId, 'Welcome back!');
    } else {
      botLocalInfo.users[fromId].state = null;
      botLocalInfo.users[fromId].chatId = chatId;
      await TelegramBotService.updateBotLocalInfo(botId, botLocalInfo);
      const opts = [[{ text: 'Login', callback_data: 'login' }]];

      logger.info(`send to bot ${JSON.stringify(moment().format())}`);
      await this.sendMessage(botId, chatId, 'Welcome! Please log in.', opts);
    }
  }

  async logicForLogin(callbackQuery, botId) {
    const { from, message } = callbackQuery;
    const { chat } = message;
    const botLocalInfo = await TelegramBotService.getBotLocalInfo(botId);
    if (botLocalInfo.users) {
      botLocalInfo.users[from.id] = {};
      botLocalInfo.users[from.id].state = 'waitingLogin';
      // botLocalInfo.users[from.id].userId = null;
    } else {
      botLocalInfo.users = {
        [from.id]: {
          state: 'waitingLogin',
        },
      };
    }
    await TelegramBotService.updateBotLocalInfo(botId, botLocalInfo);
    logger.info(`send to bot ${JSON.stringify(moment().format())}`);
    await this.sendMessage(botId, chat.id, 'type your login please!');
  }

  // eslint-disable-next-line class-methods-use-this
  async logicForLogout(callbackQuery, botId, flag = 0) {
    const { from, message, chat } = callbackQuery;
    const botLocalInfo = await TelegramBotService.getBotLocalInfo(botId);
    const fromId = from.id;
    botLocalInfo.users[fromId].loggedIn = false;
    botLocalInfo.users[fromId].state = null;
    await TelegramBotService.updateBotLocalInfo(botId, botLocalInfo);
    const opts = [[{ text: 'Login', callback_data: 'login' }]];
    logger.info(`send to bot ${JSON.stringify(moment().format())}`);

    const text =
      // eslint-disable-next-line no-nested-ternary
      flag === 1
        ? 'You are blocked!'
        : flag === 2
        ? 'Your Login and Password changed!'
        : 'You have been logged out. Thank you for using the bot!';
    await this.sendMessage(botId, chat?.id || message?.chat?.id, text, opts);
  }

  async logicForGetApps(message, botId) {
    logger.info(`telegramBotService:logicForGetApps() time: ${new Date().getTime()} ms ${JSON.stringify(message)} ${botId}`);
    const { text, from } = message;
    const { calendar } = this.bots[botId];
    const botLocalInfo = await TelegramBotService.getBotLocalInfo(botId);
    botLocalInfo.users[from.id].state = text;
    await TelegramBotService.updateBotLocalInfo(botId, botLocalInfo);
    calendar.startNavCalendar(message);
  }

  async callbacks(callbackQuery, botId) {
    const message = callbackQuery?.message || callbackQuery;
    const text = callbackQuery?.text || callbackQuery?.data;
    const chat = callbackQuery?.chat || callbackQuery?.message.chat;
    const fromId = callbackQuery?.from ? callbackQuery?.from.id : message?.from.id;
    const botLocalInfo = await TelegramBotService.getBotLocalInfo(botId);
    const userInfo = botLocalInfo.users[fromId];
    if (userInfo && !userInfo.loggedIn) {
      const login = botLocalInfo.users[fromId].state === 'waitingLogin' ? text.toString() : botLocalInfo.users[fromId].login;
      const user = await TelegramBotService.getUserInfo(login);

      if (botLocalInfo.users[fromId].state === 'waitingLogin') {
        if (user) {
          botLocalInfo.users[fromId].login = user.telegramLogin.toString();
          botLocalInfo.users[fromId].state = 'waitingPassword';
          await TelegramBotService.updateBotLocalInfo(botId, botLocalInfo);
          logger.info(`send to bot ${JSON.stringify(moment().format())}`);
          await this.sendMessage(botId, message.chat.id, 'enter password pls');
        } else {
          logger.info(`send to bot ${JSON.stringify(moment().format())}`);
          await this.sendMessage(botId, message.chat.id, "such login doesn't exist!");
        }
      } else if (botLocalInfo.users[fromId].state === 'waitingPassword') {
        if (message.text.toString() === user.telegramPassword.toString()) {
          botLocalInfo.users[fromId].password = message.text;
          botLocalInfo.users[fromId].state = null;
          botLocalInfo.users[fromId].loggedIn = true;
          botLocalInfo.users[fromId].chatId = chat.id;
          botLocalInfo.users[fromId].userId = user._id || null;
          await TelegramBotService.updateBotLocalInfo(botId, botLocalInfo);
          logger.info(`send to bot ${JSON.stringify(moment().format())}`);
          await this.sendMessage(botId, message.chat.id, 'login success.');
        } else {
          logger.info(`send to bot ${JSON.stringify(moment().format())}`);
          await this.sendMessage(botId, message.chat.id, 'wrong password!');
        }
      } else if (!botLocalInfo.users[fromId].loggedIn) {
        const opts = [[{ text: 'Login', callback_data: 'login' }]];
        logger.info(`send to bot ${JSON.stringify(moment().format())}`);
        await this.sendMessage(botId, message.chat.id, 'please login to continue', opts);
      }
    } else {
      await this.getAppsCallback(callbackQuery, botId);
    }
  }

  // eslint-disable-next-line class-methods-use-this
  async getAppsCallback(callbackQuery, botId) {
    const message = callbackQuery?.message || callbackQuery;
    const { data, from, text } = callbackQuery;
    const { bot } = this.bots[botId];
    const chatId = message.chat.id;
    const action = data ? data.split('_') : null;
    const fromId = from ? from.id : message?.from.id;
    const botLocalInfo = await TelegramBotService.getBotLocalInfo(botId);
    const state = botLocalInfo.users[fromId]?.state ? botLocalInfo.users[fromId]?.state.split('_') : null;
    const availableCommands = ['/start', '/login', '/logout', '/getapps'];
    if (botLocalInfo.users[fromId] && botLocalInfo.users[fromId].loggedIn === true) {
      if (text === '/logout') {
        await this.yesOrNoForLogout(botId, chatId);
        return;
      }
      if (!action && state) {
        if (state[0] === 'yes-cancel') {
          await this.changeAppointmentStatus(state, botId, chatId, fromId, message.text);
          return;
        }
        if (state[2] === 'writePrice') {
          await this.changeAppointmentStatusAndPrice(state, botId, chatId, fromId, message.text);
          return;
        }
      }
      if (action && action.length === 3) {
        const validDate = moment(action[1], 'DD-MM-YYYY').isValid();
        if (!validDate) {
          return;
        }
        await this.getEventList(action, botId, chatId, fromId, callbackQuery);
        return;
      }
      if (action) {
        switch (action[0]) {
          case 'no-logout':
            bot.deleteMessage(chatId, message.message_id);
            logger.info(`send to bot ${JSON.stringify(moment().format())}`);
            await this.sendMessage(botId, chatId, `Logout canceled!`);
            break;
          case 'no-process':
          case 'no-cancel':
          case 'no-completed':
            bot.deleteMessage(chatId, message.message_id);
            logger.info(`send to bot ${JSON.stringify(moment().format())}`);
            await this.sendMessage(botId, chatId, `status change canceled!`);
            break;
          case 'button':
            await this.appointmentClick(botId, chatId, action, fromId);
            break;
          case 'info':
            await this.appointmentInfo(botId, chatId, fromId, action, botLocalInfo);
            break;
          case 'process':
            await this.yesOrNo(action, botId, chatId);
            break;
          case 'yes-process':
            bot.deleteMessage(chatId, message.message_id);
            await this.changeAppointmentStatus(action, botId, chatId, fromId);
            break;
          case 'cancel':
            await this.yesOrNo(action, botId, chatId);
            break;
          case 'yes-cancel':
            bot.deleteMessage(chatId, message.message_id);
            await this.appointmentComment(action, botId, chatId, fromId);
            break;
          case 'completed':
            await this.yesOrNo(action, botId, chatId);
            break;
          case 'yes-completed':
            bot.deleteMessage(chatId, message.message_id);
            await this.openCompleteButtons(action, botId, chatId, fromId);
            break;
          case 'paid':
            await this.writePriceMsg(action, botId, chatId, fromId);
            break;
          case 'free':
            await this.changeAppointmentStatusAndPrice(action, botId, chatId, fromId, action[0]);
            break;
          case 'yes-logout':
            bot.deleteMessage(chatId, message.message_id);
            await this.logicForLogout(callbackQuery, botId);
            break;
          default:
            logger.info(`send to bot ${JSON.stringify(moment().format())}`);
            await this.sendMessage(botId, chatId, `available commands ${availableCommands.toString()}`);
            break;
        }
      } else {
        logger.info(`send to bot ${JSON.stringify(moment().format())}`);
        await this.sendMessage(botId, chatId, `available commands ${availableCommands.toString()}`);
      }
    } else {
      const opts = [[{ text: 'Login', callback_data: 'login' }]];
      logger.info(`send to bot ${JSON.stringify(moment().format())}`);
      await this.sendMessage(botId, chatId, 'please login to continue', opts);
    }
  }

  async yesOrNo(action, botId, chatId) {
    const nestedKeyboard = [
      [
        { text: 'Yes', callback_data: `yes-${action[0]}_${action[1]}` },
        { text: 'No', callback_data: `no-${action[0]}_${action[1]}` },
      ],
    ];
    logger.info(`send to bot ${JSON.stringify(moment().format())}`);
    await this.sendMessage(botId, chatId, 'Please Confirm!', nestedKeyboard);
  }

  // eslint-disable-next-line class-methods-use-this
  async yesOrNoForLogout(botId, chatId) {
    const nestedKeyboard = [
      [
        { text: 'Yes', callback_data: `yes-logout` },
        { text: 'No', callback_data: `no-logout` },
      ],
    ];
    logger.info(`send to bot ${JSON.stringify(moment().format())}`);
    await this.sendMessage(botId, chatId, 'Please Confirm!', nestedKeyboard);
  }

  async getEventList(action, botId, chatId, fromId, callbackQuery) {
    const { calendar } = this.bots[botId];
    const botLocalInfo = await TelegramBotService.getBotLocalInfo(botId);
    const validDate = moment(action[1], 'DD-MM-YYYY').isValid();
    const res = calendar.clickButtonCalendar(callbackQuery);
    if (!validDate || res === -1) {
      return;
    }
    const userInfo = botLocalInfo.users[fromId];
    const user = await TelegramBotService.getUserInfo(userInfo.login);
    if (!user) {
      await this.logicForLogout(callbackQuery.message, botId);
      return;
    }
    const events = await calendarEventRepository.getCalendarEventByEqInstaller(user, {
      startDate: moment(res, 'DD-MM-YYYY').format(),
    });

    if (!events.length) {
      logger.info(`send to bot ${JSON.stringify(moment().format())}`);
      await this.sendMessage(botId, chatId, 'data is empty!');
      return;
    }
    // eslint-disable-next-line no-restricted-syntax
    for (const event of events) {
      const inlineKeyboard = [];
      const timezoneString = user.provider.timezone;

      // Get the current offset in minutes
      const offsetInMinutes = moment.tz(timezoneString).utcOffset();
      const startDate = moment
        .utc(event?.startDate, 'YYYY-MM-DDTHH:mm:ss.SSSZ')
        .add(offsetInMinutes, 'minutes')
        .format('YYYY-MM-DDTHH:mm:ss.SSS');
      const flag =
        // eslint-disable-next-line no-nested-ternary
        event?.state === 'process' ? '🟡' : event?.state === 'completed' ? '🟢' : event?.state === 'cancel' ? '🔴' : '⚪';
      const text = `${flag} ${moment(startDate, 'YYYY-MM-DDTHH:mm:ss.SSS').format('h:mm a')}
${event?.customerAddress.city}, ${event?.customerAddress.province}`;

      inlineKeyboard.push([
        {
          text: 'Click for more Info!',
          callback_data: `button_${event?._id}`,
        },
      ]);

      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await this.sendMessageWithAPI(botId, chatId, text, inlineKeyboard);
        if (result.status) {
          // eslint-disable-next-line no-await-in-loop
          await botMessagesRepository.getBotMessageByChatIdAndPushMessageId(chatId, result.messageId);
        }
      } catch (error) {
        // eslint-disable-next-line no-await-in-loop
        const result = await this.sendMessageWithAPI(botId, chatId, text, inlineKeyboard);
        if (result.status) {
          // eslint-disable-next-line no-await-in-loop
          await botMessagesRepository.getBotMessageByChatIdAndPushMessageId(chatId, result.messageId);
        }
      }
    }
  }

  async sendMessageWithAPI(botId, chatId, text, inlineKeyboard) {
    try {
      const { bot } = this.bots[botId];
      const response = await axios.post(`https://api.telegram.org/bot${bot.token}/sendMessage`, {
        chat_id: chatId,
        text,
        reply_markup: inlineKeyboard
          ? {
              inline_keyboard: inlineKeyboard,
            }
          : {},
      });
      return {
        status: !!response,
        messageId: response?.data?.result?.message_id,
      };
    } catch (error) {
      logger.error(`telegramBot sendMessage: ${error.message}`);
      return false;
    }
  }

  async writePriceMsg(action, botId, chatId, fromId) {
    const text = 'Please write price!';
    const botLocalInfo = await TelegramBotService.getBotLocalInfo(botId);
    botLocalInfo.users[fromId].state = `${action[0]}_${action[1]}_writePrice`;
    await TelegramBotService.updateBotLocalInfo(botId, botLocalInfo);
    logger.info(`send to bot ${JSON.stringify(moment().format())}`);
    await this.sendMessage(botId, chatId, text);
  }

  async openCompleteButtons(action, botId, chatId, fromId) {
    const [{ event, status }, botLocalInfo] = await Promise.all([
      this.checkEventStatus(action[1]),
      TelegramBotService.getBotLocalInfo(botId),
    ]);
    if (!status) {
      logger.info(`send to bot ${JSON.stringify(moment().format())}`);
      await this.sendMessage(botId, chatId, `This event already ${event?.state}`);
      return;
    }
    if (event?.paymentType === 'unpaid') {
      await this.writePriceMsg(action, botId, chatId, fromId);
      return;
    }
    botLocalInfo.users[fromId].state = `${action[0]}_${action[1]}_writePrice`;
    await TelegramBotService.updateBotLocalInfo(botId, botLocalInfo);
    let nestedKeyboard = {};
    let text = 'Please write price!';
    if (event?.paymentType === 'pending') {
      text = 'Choose option';
      nestedKeyboard = [
        [
          { text: 'Paid', callback_data: `paid_${action[1]}` },
          { text: 'Free', callback_data: `free_${action[1]}` },
        ],
      ];
      logger.info(`send to bot ${JSON.stringify(moment().format())}`);
      await this.sendMessage(botId, chatId, text, nestedKeyboard);
    } else {
      await this.changeAppointmentStatusAndPrice(action, botId, chatId, fromId, event?.paymentPrice);
    }
  }

  async appointmentClick(botId, chatId, action, fromId) {
    const [event, botLocalInfo] = await Promise.all([
      calendarEventRepository.getCalendarEventById(action[1]),
      TelegramBotService.getBotLocalInfo(botId),
    ]);

    const user = await TelegramBotService.getUserInfo(botLocalInfo.users[fromId].login);
    const timezoneString = user.provider.timezone;

    // Get the current offset in minutes
    const offsetInMinutes = moment.tz(timezoneString).utcOffset();
    const startDate = moment.utc(event?.startDate, 'YYYY-MM-DDTHH:mm:ss.SSSZ').add(offsetInMinutes, 'minutes');
    const nowDay = moment.utc().format('YYYY-MM-DD');
    const getDay = startDate.format('YYYY-MM-DD');
    const nestedKeyboard =
      // eslint-disable-next-line no-nested-ternary
      event?.state === 'completed' || event?.state === 'cancel' || nowDay > getDay
        ? [[{ text: 'Info', callback_data: `info_${action[1]}` }]]
        : event?.state === 'process'
        ? [
            [{ text: 'Info', callback_data: `info_${action[1]}` }],
            [
              { text: 'Completed', callback_data: `completed_${action[1]}` },
              { text: 'Cancel', callback_data: `cancel_${action[1]}` },
            ],
          ]
        : [
            [
              { text: 'Info', callback_data: `info_${action[1]}` },
              { text: 'Process', callback_data: `process_${action[1]}` },
            ],
            [
              { text: 'Completed', callback_data: `completed_${action[1]}` },
              { text: 'Cancel', callback_data: `cancel_${action[1]}` },
            ],
          ];
    const address = `
  ${moment(startDate.format('YYYY-MM-DDTHH:mm:ss.SSS'), 'YYYY-MM-DDTHH:mm:ss.SSS').format('h:mm a')}\n${
      event?.customerAddress?.address
    }\n${event?.customerAddress?.city} ${event?.customerAddress?.province}
  ${event?.customerAddress?.zip}`;
    logger.info(`send to bot ${JSON.stringify(moment().format())}`);
    await this.sendMessage(botId, chatId, address, nestedKeyboard);
  }

  async appointmentInfo(botId, chatId, fromId, action, botLocalInfo) {
    if (botLocalInfo.users[fromId].state === '/getapps') {
      const event = await calendarEventRepository.getCalendarEventById(action[1]);
      const user = await TelegramBotService.getUserInfo(botLocalInfo.users[fromId].login);
      const timezoneString = user.provider.timezone;

      // Get the current offset in minutes
      const offsetInMinutes = moment.tz(timezoneString).utcOffset();
      const startDate = moment.utc(event?.startDate, 'YYYY-MM-DDTHH:mm:ss.SSSZ').add(offsetInMinutes, 'minutes');
      const nowDay = moment.utc().format('YYYY-MM-DD');
      const getDay = startDate.format('YYYY-MM-DD');

      let messageData = await TelegramBotService.writeEventInfo(event, botId, fromId);
      // console.log('messageData: ', messageData, event);
      const nestedKeyboard =
        event?.state !== 'cancel' && event?.state !== 'completed' && nowDay <= getDay
          ? [
              [{ text: 'Visit Google Map', url: `${messageData.googleMapsLink}` }],
              event?.state !== 'process' ? [{ text: 'Process', callback_data: `process_${action[1]}` }] : [],
              [
                { text: 'Completed', callback_data: `completed_${action[1]}` },
                { text: 'Cancel', callback_data: `cancel_${action[1]}` },
              ],
            ]
          : [[{ text: 'Visit Google Map', url: `${messageData.googleMapsLink}` }]];
      try {
        logger.info(`send to bot ${JSON.stringify(moment().format())}`);
        await this.sendMessage(botId, chatId, messageData.message, nestedKeyboard);
      } catch (error) {
        logger.info(`Error: ${JSON.stringify(error)}`);
        messageData = await TelegramBotService.writeEventInfo(event, botId, fromId, true);
        logger.info(`send to bot ${JSON.stringify(moment().format())}`);
        await this.sendMessage(botId, chatId, messageData.message, nestedKeyboard);
      }
    }
  }

  async appointmentComment(action, botId, chatId, fromId) {
    const [botLocalInfo, { event, status }] = await Promise.all([
      TelegramBotService.getBotLocalInfo(botId),
      this.checkEventStatus(action[1]),
    ]);
    if (status && botLocalInfo && botLocalInfo.users[fromId].state === '/getapps') {
      // eslint-disable-next-line no-param-reassign
      botLocalInfo.users[fromId].state = `${action[0]}_${action[1]}_writeComment`;
      await TelegramBotService.updateBotLocalInfo(botId, botLocalInfo);
      logger.info(`send to bot ${JSON.stringify(moment().format())}`);
      await this.sendMessage(botId, chatId, 'Please write comment!');
    } else {
      logger.info(`send to bot ${JSON.stringify(moment().format())}`);
      await this.sendMessage(botId, chatId, `This event already ${event?.state}`);
    }
  }

  // eslint-disable-next-line class-methods-use-this
  async checkEventStatus(eventId) {
    const event = await calendarEventRepository.getCalendarEventById(eventId);
    if (event?.state === 'completed' || event?.state === 'cancel') {
      return {
        event,
        status: 0,
      };
    }
    return {
      event,
      status: 1,
    };
  }

  async changeAppointmentStatus(state, botId, chatId, fromId, text = null) {
    let statusName = state[0].split('-');
    statusName = statusName.length === 1 ? statusName[0] : statusName[1];
    const [botLocalInfo, { event, status }] = await Promise.all([
      TelegramBotService.getBotLocalInfo(botId),
      this.checkEventStatus(state[1]),
    ]);
    const { comments } = event;
    if (!status) {
      logger.info(`send to bot ${JSON.stringify(moment().format())}`);
      await this.sendMessage(botId, chatId, `This event already ${event?.state}`);
      return;
    }
    if (
      state[0] !== 'yes-cancel' ||
      (state[0] === 'yes-cancel' && botLocalInfo.users[fromId].state === `${state[0]}_${state[1]}_writeComment`)
    ) {
      const user = await TelegramBotService.getUserInfo(botLocalInfo.users[fromId].login);
      if (text) {
        comments.push({
          comment: text,
          isCancel: state[0] === 'yes-cancel',
          user: botLocalInfo.users[fromId].userId,
          userName: `${user.firstname} ${user.lastname}`,
        });
      }
      botLocalInfo.users[fromId].state = `/getapps`;
      logger.info(`send to bot ${JSON.stringify(moment().format())}`);
      await Promise.all([
        calendarEventRepository.updateCalendarEventByIdNew(state[1], {
          state: statusName,
          comments,
        }),
        TelegramBotService.updateBotLocalInfo(botId, botLocalInfo),
        this.sendMessage(botId, chatId, `Event status successfuly changed to ${statusName}`),
        BroadcastService.broadcastToProvider(user?.provider?._id?.toString(), 'appointment-update', {
          data: [],
        }),
      ]);
    }
  }

  async changeAppointmentStatusAndPrice(action, botId, chatId, fromId, text = null) {
    const [botLocalInfo, { event }] = await Promise.all([
      TelegramBotService.getBotLocalInfo(botId),
      this.checkEventStatus(action[1]),
    ]);

    const user = await TelegramBotService.getUserInfo(botLocalInfo.users[fromId].login);

    const calendarObj = {
      state: 'completed',
      paymentType: event?.paymentType !== 'free' && text !== 'free' ? 'paid' : 'free',
      paymentPaid: event?.paymentType !== 'free' && text !== 'free' ? text : 0,
    };

    botLocalInfo.users[fromId].state = `/getapps`;
    logger.info(`send to bot ${JSON.stringify(moment().format())}`);
    await Promise.all([
      TelegramBotService.updateBotLocalInfo(botId, botLocalInfo),
      calendarEventRepository.updateCalendarEventByIdNew(action[1], calendarObj),
      this.sendMessage(botId, chatId, `Event is successfuly completed!`),
      BroadcastService.broadcastToProvider(user?.provider?._id?.toString(), 'appointment-update', {
        data: [],
      }),
    ]);
  }

  isRunning(provider, token) {
    return !!Object.keys(this.bots).filter((r) => this.bots[r].token === token).length;
  }

  getBots() {
    return Object.keys(this.bots).map((r) => {
      return { token: this.bots[r].token, provider: this.bots[r].provider };
    });
  }

  getRunnings() {
    return Object.keys(this.bots).map((r) => this.bots[r]);
  }

  // eslint-disable-next-line no-unused-vars
  stopBot(provider, token) {
    const list = Object.keys(this.bots).map((r) => this.bots[r]);
    const foundList = list.filter((r) => r.provider === provider);
    // eslint-disable-next-line no-restricted-syntax
    for (const item of foundList) {
      const { key } = item;
      if (!this.bots[key]) {
        logger.info(`TelegramBotService: bot ${key} not found to stop`);
        return;
      }
      this.bots[key].bot.stopPolling();
      delete this.bots[key].bot;
      delete this.bots[key];
      logger.info(`TelegramBotService: bot ${key} stoped`);
    }
    if (!foundList.length) {
      logger.info(`TelegramBotService: bot ${provider}-${token} not found to stop`);
    }
  }

  static async getBotLocalInfo(botId) {
    const list = await telegramBotRepository.getList({ botId });
    if (!list.length) {
      const current = await telegramBotRepository.createTelegramBot({ botId });
      return current.toJSON();
    }
    return list[0].toJSON();
  }

  static async updateBotLocalInfo(botId, update) {
    await telegramBotRepository.updateOne({ botId }, update);
    const list = await telegramBotRepository.getList({ botId });
    return list[0].toJSON();
  }

  static async getUserInfo(login) {
    const user = await userRepository.getUserByTelegramLogin(login);
    return user;
  }

  static async comments(comments) {
    let text = '';
    // eslint-disable-next-line no-restricted-syntax
    for (const elem of comments) {
      text += `\n
from: ${elem?.userName},
content: ${elem?.comment.includes('<p') ? elem?.comment.replace(/<p>|<\/p>/g, '') : elem?.comment},
${elem.isCancel ? 'isCancel: 🔴' : ''}
------------------------------------------------------------
      `;
    }
    return text;
  }

  static async connections(locations, login) {
    let connections = '';
    // eslint-disable-next-line no-restricted-syntax
    const location = locations.filter((item) => item.login === login);
    // eslint-disable-next-line no-restricted-syntax
    for (const sub of location[0].packageSubscriptions) {
      const names = sub.name.filter((item) => item.lang === 'en');
      connections += names.length ? `${names[0].name}\n` : `${sub.name[0].name}\n`;
    }
    return connections;
  }

  static async phones(phones, flag) {
    let phonesStr = '';
    // eslint-disable-next-line no-restricted-syntax
    for (const item of phones) {
      phonesStr += flag
        ? `\n${item?.phone.replace(/[-\s]/g, '')}`
        : `\n[${item?.phone.replace(/[-\s]/g, '')}](tel:${item?.phone.replace(/[-\s]/g, '')})`;
    }
    return phonesStr;
  }

  static async writeEventInfo(event, botId, fromId, flag = false) {
    const botLocalInfo = await TelegramBotService.getBotLocalInfo(botId);
    const user = await this.getUserInfo(botLocalInfo.users[fromId].login);

    const timezoneString = user.provider.timezone;

    // Get the current offset in minutes
    const offsetInMinutes = moment.tz(timezoneString).utcOffset();
    const startDate = moment
      .utc(event?.startDate, 'YYYY-MM-DDTHH:mm:ss.SSSZ')
      .add(offsetInMinutes, 'minutes')
      .format('YYYY-MM-DDTHH:mm:ss.SSS');
    const endDate = moment
      .utc(event?.endDate, 'YYYY-MM-DDTHH:mm:ss.SSSZ')
      .add(offsetInMinutes, 'minutes')
      .format('YYYY-MM-DDTHH:mm:ss.SSS');

    const address = `${event?.customerAddress?.address} ${event?.customerAddress?.suite || ''} ${
      event?.customerAddress?.city
    } ${event?.customerAddress?.province} ${event?.customerAddress?.zip}`;

    const googleMapsLink = `https://www.google.com/maps?q=${encodeURIComponent(address)}`;
    const fullAddress = address;

    const [comments, connections, phones] = await Promise.all([
      TelegramBotService.comments(event?.comments),
      TelegramBotService.connections(event?.client?.info?.locations, event?.location?.login),
      TelegramBotService.phones(event?.client?.phones, flag),
    ]);

    const clientProviderName = event?.client.provider.name[0].name;
    const ownerFullName = `${event?.user?.firstname} ${event?.user?.lastname}`;

    const location = JSON.stringify(`Name:   ${event?.location?.locationName}
Login:   ${event?.location?.login}
Password:   ${event?.location?.password}
Rooms:   ${event?.location?.roomsCount}`);
    const message = JSON.stringify(`EVENT INFO\n
Event By: ${ownerFullName}\n
Equipment Installer: ${event?.equipmentInstaller?.firstname} ${event?.equipmentInstaller?.lastname}\n
Status: ${event?.state.charAt(0).toUpperCase() + event?.state.slice(1)}

Date: ${moment(startDate, 'YYYY-MM-DDTHH:mm:ss.SSS').format('MM/DD/YYYY')} - ${moment(
      endDate,
      'YYYY-MM-DDTHH:mm:ss.SSSZ'
    ).format('MM/DD/YYYY')}
${moment(startDate, 'YYYY-MM-DDTHH:mm:ss.SSS').format('h:mm a')} - ${moment(endDate, 'YYYY-MM-DDTHH:mm:ss.SSSZ').format(
      'h:mm a'
    )}

Title: ${event?.title}

Customer: ${event?.client?.personalInfo?.firstname} ${event?.client.personalInfo?.lastname} (${clientProviderName})

Customer Phones: ${phones}

Address: ${fullAddress}

Location:   ${JSON.parse(location)}

Connections:
${connections}

Payment status: ${event?.paymentType}
Expected Pay:  ${event?.paymentPrice ? '$'+event?.paymentPrice : event?.paymentType}
${event?.paymentPaid ? 'Actual Pay:  $'+event?.paymentPaid : event?.paymentType === 'free' ? 'Actual Pay:  free' : ''}

Comments: ${comments}`);

    return { message: JSON.parse(message), googleMapsLink };
  }

  // eslint-disable-next-line no-unused-vars
  async runBot(provider, token) {
    const key = `${provider}-${token}`;
    if (Object.keys(this.bots).filter((r) => this.bots[r].token === token).length) {
      logger.error(`bot already running ${key}`);
      return;
    }
    // Create a bot that uses 'polling' to fetch new updates
    const bot = new TelegramBot(token, { polling: config.getConfig().telegram.polling });

    bot.setMyCommands([
      { command: '/start', description: 'Start' },
      { command: '/getapps', description: 'Get List by Date' },
      { command: '/logout', description: 'Logout' },
    ]);
    const calendar = new Calendar(bot, {
      date_format: 'DD-MM-YYYY',
      language: 'en',
    });
    if (!config.getConfig().telegram.polling) {
      // This informs Telegram where to send updates
      bot.setWebHook(`${config.getConfig().telegram.webhookurl}?token=${token}`);
    } else {
      bot.onText(/\/\w+|\w+/, async (message) => {
        await this.processTelegramWebhook({
          message,
          token,
        });
      });
      bot.on('callback_query', async (callbackQuery) => {
        await this.processTelegramWebhook({
          callback_query: callbackQuery,
          token,
        });
      });
    }

    bot.on('polling_error', (error) => {
      logger.info(`${error.message} ${error.code}`);
    });

    this.bots[key] = {
      bot,
      provider,
      token,
      key,
      calendar,
    };
    logger.info(
      `telegra bot: bot ${provider}-${token} is running (polling: ${config.getConfig().telegram.polling}, wehookurl: ${
        config.getConfig().telegram.webhookurl
      })...`
    );
  }

  async sendMessage(botId, chatId, text, inlineKeyboard = []) {
    try {
      const { bot } = this.bots[botId];
      const response = await bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: inlineKeyboard,
        },
      });
      await botMessagesRepository.getBotMessageByChatIdAndPushMessageId(response.chat.id, response.message_id);

      return !!response;
    } catch (error) {
      logger.error(`telegramBot sendMessage: ${error.message}`);
      return false;
    }
  }

  async clearHistory({ newUser: user, provider }) {
    const { id } = user;
    const botToken = provider[0].telegram.authToken;
    const botId = `${provider[0].providerId}-${botToken}`;

    const botLocalInfo = await TelegramBotService.getBotLocalInfo(botId);
    const sameBotProfiles = [];

    // eslint-disable-next-line no-restricted-syntax
    for (const elem in botLocalInfo.users) {
      if (botLocalInfo.users[elem].userId && botLocalInfo.users[elem].userId.toString() === id.toString()) {
        sameBotProfiles.push({
          fromId: elem,
          chatId: botLocalInfo.users[elem].chatId,
        });
      }
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const profile of sameBotProfiles) {
      if (profile.fromId) {
        botLocalInfo.users[profile.fromId].loggedIn = false;
        botLocalInfo.users[profile.fromId].state = null;
        // eslint-disable-next-line no-await-in-loop
        await TelegramBotService.updateBotLocalInfo(botId, botLocalInfo);
      }
      this.deleteMessagesByCircle(botId, profile.chatId);
    }
  }

  async deleteMessagesByCircle(botId, chatId) {
    const botinfo = this.bots[botId];

    const chatMessages = await botMessagesRepository.getBotMessageByChatId(chatId);

    if (chatMessages) {
      // eslint-disable-next-line no-restricted-syntax
      for (const messageId of chatMessages.messageIds) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await botinfo.bot.deleteMessage(chatId, messageId, {
            GET: ['JSON'],
          });
          // eslint-disable-next-line no-empty
        } catch (error) {}
      }
      await botMessagesRepository.BotMessageByIdAndUpdate(chatMessages._id, {
        messageIds: [],
      });
    }
  }

  async getBotByTokenAndClear(botId) {
    const { bot, token } = this.bots[botId];

    const [botMessages, ottProvider] = await Promise.all([
      botMessagesRepository.getBotMessagesByBotId(botId),
      ottProviderConversationProviderRepository.getList(
        {
          'telegram.authToken': token,
        },
        ['providerId']
      ),
    ]);

    const timezoneString = ottProvider[0].providerId.timezone;
    const offsetInMinutes = moment.tz(timezoneString).utcOffset();
    logger.info(`offsetInMinutes: ${offsetInMinutes}`)
    const endOfDay = moment().endOf('day').add(offsetInMinutes, 'minutes');
    logger.info(`endOfDay: ${endOfDay}`)
    const nowDateByProvider = moment().add(offsetInMinutes, 'minutes');
    logger.info(`moment: ${moment.utc()} ${moment()}`)
    logger.info(`nowDateByProvider: ${nowDateByProvider}`)

    const min = (endOfDay - nowDateByProvider) / 60000;
    logger.info(`min: ${min}`)
    // eslint-disable-next-line no-restricted-syntax
    for (const botMessage of botMessages) {
      const lastClearingDate = botMessage?.lastClearingDate
        ? moment.utc(botMessage?.lastClearingDate, 'YYYY-MM-DDTHH:mm:ssZ')
        : 0;
      logger.info(`lastClearingDate: ${lastClearingDate}`)
      const failMin = (nowDateByProvider - lastClearingDate) / 60000;

      logger.info(`failMin: ${failMin}`)
      if (min <= 10 && failMin > 10) {
        // eslint-disable-next-line no-restricted-syntax
        for (const messageId of botMessage.messageIds) {
          try {
            // eslint-disable-next-line no-await-in-loop
            await bot.deleteMessage(botMessage.chatId, messageId, {
              GET: ['JSON'],
            });
            // eslint-disable-next-line no-empty
          } catch (error) {}
        }
        // eslint-disable-next-line no-await-in-loop
        await botMessagesRepository.BotMessageByIdAndUpdate(botMessage._id, {
          messageIds: [],
          lastClearingDate: nowDateByProvider.format(),
        });
      }
    }
  }
}

module.exports = TelegramBotService;
