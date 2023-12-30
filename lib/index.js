"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_telegram_bot_api_1 = __importDefault(require("node-telegram-bot-api"));
require("dotenv").config();
const state = {
    users: {}
};
const getUser = (chatId, name) => {
    state.users[chatId] = state.users[chatId] || { role: 'User', name };
    return state.users[chatId];
};
const setRole = (chatId, role) => {
    state.users[chatId] = Object.assign(Object.assign({}, state.users[chatId]), { role });
};
const setUserLastMessageId = (chatId, lastMessageId) => {
    state.users[chatId] = Object.assign(Object.assign({}, state.users[chatId]), { lastMessageId });
};
const setUserWaitAction = (chatId, waitAction) => {
    state.users[chatId] = Object.assign(Object.assign({}, state.users[chatId]), { waitAction });
};
const getUserWaitAction = (chatId) => {
    var _a;
    return (_a = state.users[chatId]) === null || _a === void 0 ? void 0 : _a.waitAction;
};
const removeLastMessage = (msg) => __awaiter(void 0, void 0, void 0, function* () {
    if (msg) {
        const user = getUser(msg.chat.id, msg.chat.first_name);
        if (user.lastMessageId) {
            yield bot.deleteMessage(msg.chat.id, user.lastMessageId);
            setUserLastMessageId(msg.chat.id, undefined);
        }
    }
});
const setMessageWithLast = (chatId, text, options) => __awaiter(void 0, void 0, void 0, function* () {
    const { message_id } = yield bot.sendMessage(chatId, text, options);
    setUserLastMessageId(chatId, message_id);
});
const showAdminMenu = (msg) => __awaiter(void 0, void 0, void 0, function* () {
    yield removeLastMessage(msg);
    yield setMessageWithLast(msg.chat.id, 'Вы Админ.', {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Команды', callback_data: 'teams' }, { text: 'Добавить команду', callback_data: 'add_team' }]
            ]
        }
    });
});
const showUserMenu = (msg) => __awaiter(void 0, void 0, void 0, function* () {
    yield removeLastMessage(msg);
    yield setMessageWithLast(msg.chat.id, 'Выберите Команду', {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Команда 1', callback_data: 'select team 1' }],
                [{ text: 'Команда 2', callback_data: 'select team 2' }],
                [{ text: 'Команда 3', callback_data: 'select team 3' }],
                [{ text: 'Команда 4', callback_data: 'select team 4' }]
            ]
        }
    });
});
const bot = new node_telegram_bot_api_1.default(process.env.BOT_TOKEN || 'TEST', { polling: true });
bot.setMyCommands(require('./commands.json').commands);
bot.onText(/\/start/, (msg) => __awaiter(void 0, void 0, void 0, function* () {
    const user = getUser(msg.chat.id, msg.chat.first_name);
    switch (user.role) {
        case 'ADMIN':
            yield showAdminMenu(msg);
            break;
        case 'USER':
            yield showUserMenu(msg);
            break;
    }
}));
bot.onText(/\/admin/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Введите /auth логин пароль');
});
bot.onText(/\/auth (.+) (.+)/, (msg, match) => __awaiter(void 0, void 0, void 0, function* () {
    const [, login, password] = match || [];
    const success = login === process.env.ADMIN_LOGIN && password === process.env.ADMIN_PASSWORD;
    if (success) {
        setRole(msg.chat.id, 'ADMIN');
    }
    // send back the matched "whatever" to the chat
    yield bot.sendMessage(msg.chat.id, success ? 'You are now logged in as Admin.' : 'Wrong login/password.');
}));
bot.onText(/\/logout/, (msg, match) => __awaiter(void 0, void 0, void 0, function* () {
    const { role } = getUser(msg.chat.id, msg.chat.first_name);
    setRole(msg.chat.id, 'USER');
    // send back the matched "whatever" to the chat
    yield bot.sendMessage(msg.chat.id, role === 'USER' ? 'You are not logged in.' : 'Logged out.');
}));
bot.on('callback_query', (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    const msg = ctx.message;
    switch (ctx.data) {
        case 'add_team':
            if (msg) {
                yield removeLastMessage(msg);
                yield bot.sendMessage(msg.chat.id, 'Введите название команды');
                setUserWaitAction(msg.chat.id, 'team_name');
            }
            break;
    }
    console.log(ctx);
}));
bot.onText(/^[\w\s\u{0400}–\u{04FF}]+$/, (msg, match) => __awaiter(void 0, void 0, void 0, function* () {
    const waitAction = getUserWaitAction(msg.chat.id);
    switch (waitAction) {
        case 'team_name':
            console.log(msg.text);
            break;
    }
}));
// Listen for any kind of message. There are different kinds of
// messages.
