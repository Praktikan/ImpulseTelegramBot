import TelegramBot, {Chat, SendMessageOptions} from "node-telegram-bot-api";
import { config } from 'dotenv'
import commands from './commands.json'
import games from './games'

const DELIMETER_TEXT = '〰〰〰〰〰〰〰〰〰'

config()

type WaitAction = 'team_name'

type Role = 'USER' | 'ADMIN'

type BotChat = Pick<Chat, 'id' | 'first_name'>

interface BotMessage {
    chat: BotChat
}

interface User {
    role: Role
    name: string | undefined
    lastMessageId?: number | undefined
    waitAction?: WaitAction | undefined
    teamName?: string | undefined
}

interface UsersMap {
    [key: number]: User
}

interface Answer {
    [key: string]: string
}

interface AnswersMap {
    [key: string]: Answer
}

interface Team {
    answers: AnswersMap
}

interface TeamsMap {
    [key: string]: Team | undefined
}

interface AppState {
    users: UsersMap,
    teams: TeamsMap,
    game: {
        id: string
        questionNumber: number
        waiting?: boolean
    } | undefined
}

const NORMAL_TEXT_REGEXP = /^[\w\u{0400}-\u{04FF}][\w\s\u{0400}-\u{04FF}]*[\w\u{0400}-\u{04FF}]$/u
const NON_COMMAND_REGEXP = /^[^\/]/u
const CONTEXT_DATA_COMMAND_REGEXP = /(\w+)\s?(.*)/u

const state: AppState = {
    users: {},
    teams: {},
    game: undefined
}

const setGameInProgress = (id: string): void => {
    state.game = { id, questionNumber: games[id].stepped ? -1 : 0, waiting: games[id].stepped }
}

const isSteppedQuestion = (): boolean => {
    if (state.game) {
        return !!games[state.game.id].stepped
    }
    return false
}

const setTeamCurrentAnswer = (teamName: string, answer: string): void => {
    const team = state.teams[teamName]
    if (state.game && team) {
        const { id, questionNumber } = state.game
        team.answers[id][questionNumber] = answer
    }
}

const updateGameQuestionNumberOrStop = (): boolean => {
    if (state.game) {
        if (state.game.questionNumber < games[state.game.id].questions.length - 1) {
            state.game.questionNumber++
            state.game.waiting = false
            return true
        } else {
            removeGameInProgress()
            return false
        }
    }
    return false
}

const getGameRoundLength = (): number => {
    if (state.game) {
        return games[state.game.id].roundLength
    }
    return 0
}

const setWaitingForLevelSwitch = () => {
    if (state.game) {
        state.game.waiting = true
    }
}

const removeGameInProgress = (): void => {
    state.game = undefined
}

const getUser = (msg: BotMessage): User => {
    const { chat: { id: chatId, first_name: name } } = msg

    state.users[chatId] = state.users[chatId] || { role: 'USER', name }
    return state.users[chatId]
}

const getFreeUsers = (excludeAdmins?: boolean): number[] => {
    return Object.keys(state.users).map(chatId => Number(chatId))
        .filter(chatId => !state.users[chatId].teamName || (!excludeAdmins && state.users[chatId].role === 'ADMIN'))
}

const getNotFreeUsers = (excludeAdmins?: boolean): number[] => {
    return Object.keys(state.users).map(chatId => Number(chatId))
        .filter(chatId => !!state.users[chatId].teamName || (!excludeAdmins && state.users[chatId].role === 'ADMIN'))
}

const getTeamUsers = (teamName: string, excludeAdmins?: boolean): number[] => {
    return Object.keys(state.users).map(chatId => Number(chatId))
        .filter(chatId => state.users[chatId].teamName === teamName || (!excludeAdmins && state.users[chatId].role === 'ADMIN'))
}

const setRole = (chatId: number, role: Role): void => {
    state.users[chatId] = {
        ...state.users[chatId],
        role
    }
}

const setUserLastMessageId = (chatId: number, lastMessageId: number | undefined): void => {
    state.users[chatId] = {
        ...state.users[chatId],
        lastMessageId
    }
}

const setUserWaitAction = (chatId: number, waitAction: WaitAction | undefined): void => {
    state.users[chatId] = {
        ...state.users[chatId],
        waitAction
    }
}

const addTeam = (teamName: string): boolean => {
    if (!state.teams[teamName]) {
        const answers: AnswersMap = {}
        Object.keys(games).forEach(gameId => answers[gameId] = {})
        state.teams[teamName] = { answers }
        return true
    }
    return false
}

const removeTeam = (teamName: string): number[] => {
    const updatedTeams: TeamsMap = {}

    Object.keys(state.teams).forEach(team => {
        if (team !== teamName) {
            updatedTeams[team] = state.teams[team]
        }
    })

    state.teams = updatedTeams

    const updatedChatIds = Object.keys(state.users)
        .map(chatId => Number(chatId))
        .filter(chatId => state.users[chatId].teamName === teamName)

    const newUsers: UsersMap = {}

    Object.keys(state.users).forEach(chatIdString => {
        const chatId = Number(chatIdString)
        if (state.users[chatId].teamName === teamName) {
            updatedChatIds.push(chatId)
            newUsers[chatId] = {
                ...state.users[chatId],
                teamName: undefined
            }
        } else {
            newUsers[chatId] = state.users[chatId]
        }
    })

    state.users = newUsers

    return updatedChatIds
}

const joinTeam = (msg: BotMessage, teamName: string): boolean => {
    if (!state.teams[teamName]) {
        return false
    }
    state.users[msg.chat.id] = {
        ...state.users[msg.chat.id],
        teamName
    }
    return true
}

const leaveTeam = (msg: BotMessage): boolean => {
    const { teamName } = getUser(msg)
    const haveTeam = !!teamName && !!state.teams[teamName]
    state.users[msg.chat.id] = {
        ...state.users[msg.chat.id],
        teamName: undefined
    }
    return haveTeam
}

const timesLeftMessage = async (timeLeft: number) => {
    await showAllNotFreeUsersMessage(`<i>Осталось ${timeLeft} секунд</i>`)
    await updateAllNotFreeUsersMenu()
}

const waitForSwitchLevel = async () => {
    setWaitingForLevelSwitch()
    await updateAllNotFreeUsersMenu()
}

const switchLevel = async () => {
    if (updateGameQuestionNumberOrStop()) {
        const roundLength = getGameRoundLength()
        const steppedQuestion = isSteppedQuestion()
        if (roundLength) {
            await showAllNotFreeUsersMessage(DELIMETER_TEXT, true)
            await showAllNotFreeUsersMessage(getLevelQuestionNumber(), true)
            await showAllNotFreeUsersMessage(getLevelQuestion(), true)
            setTimeout(() => steppedQuestion ? waitForSwitchLevel() : switchLevel(), roundLength)
            setTimeout(() => timesLeftMessage(30), roundLength - 30000)
            setTimeout(() => timesLeftMessage(10), roundLength - 10000)
        }

    } else {
        await showAllNotFreeUsersMessage(DELIMETER_TEXT, true)
        await showAllNotFreeUsersMessage('Раунд закончен', true)
    }
    await updateAllNotFreeUsersMenu()
}

const startGame = async (id: string) => {
    setGameInProgress(id)
    const roundLength = getGameRoundLength()
    const steppedQuestion = isSteppedQuestion()
    if (roundLength && !steppedQuestion) {
        await showAllNotFreeUsersMessage(DELIMETER_TEXT, true)
        await showAllNotFreeUsersMessage(getLevelQuestionNumber(), true)
        await showAllNotFreeUsersMessage(getLevelQuestion(), true)
        setTimeout(() => steppedQuestion ? waitForSwitchLevel() : switchLevel(), roundLength)
        setTimeout(() => timesLeftMessage(parseInt(String(roundLength / 2000))), parseInt(String(roundLength / 2)))
        setTimeout(() => timesLeftMessage(10), roundLength - 10000)
    }
    await updateAllNotFreeUsersMenu()
}

const removeLastMessage = async (msg: BotMessage | undefined)=> {
    if (msg) {
        const user = getUser(msg)
        if (user.lastMessageId) {
            try {
                await bot.deleteMessage(msg.chat.id, user.lastMessageId)
            } catch (skip) {}
            setUserLastMessageId(msg.chat.id, undefined)
        }
    }
}

const setMessageWithLast = async (
    chatId: number,
    text: string,
    options?: SendMessageOptions
) => {

    const { message_id } = await bot.sendMessage(chatId, text, options)
    setUserLastMessageId(chatId, message_id)
}

const setMessageWithWaitAction = async (
    chatId: number,
    text: string,
    options: SendMessageOptions,
    waitAction: WaitAction
) => {
    const { message_id } = await bot.sendMessage(chatId, text, options)
    setUserWaitAction(chatId, waitAction)
}

const getGameResults = (gameId: string) => {
    const { name, questions } = games[gameId]
    return `Игра ${name}\n\n${questions
        .map(
            ({ text, correct }, index) =>
                `<b>Вопрос ${index + 1}</b>: ${text}\n\n<b>Правильный ответ</b>: ${correct}\n\n<b>Ответы команд</b>:\n${Object.keys(state.teams)
                    .map(
                        teamName =>
                            `        <b>${teamName}</b>: ${state.teams[teamName]?.answers[gameId][index] ?? '<i>Нет ответа</i>'}`
                    )
                    .join('\n')
            }`
        )
        .join(`\n${DELIMETER_TEXT}\n`)
    }`
}

const getGameAdminState = (): string => {
    if (state.game) {
        const { id, questionNumber, waiting} = state.game
        const { name, questions } = games[id]
        const currentQuestion = questionNumber > -1 ? `\n\nВопрос ${questionNumber + 1}: ${questions[questionNumber].text}` : ''
        const currentAnswers = questionNumber > -1 ? `\n\n${Object.keys(state.teams).map(teamName => `<b>${teamName}</b>: ${state.teams[teamName]?.answers[id][questionNumber] ?? '<i>Ждём ответ</i>'}`).join('\n')}` : ''
        const correctAnswer = questionNumber > -1 ? `\n\n<b>Правильный ответ</b>: ${questions[questionNumber].correct}` : ''
        const nextQuestion = waiting && questionNumber < questions.length - 1 ? `\n\n<b>Следующий вопрос</b>: ${questions[questionNumber + 1].text}` : ''
        return `Игра ${name}.${currentQuestion}${currentAnswers}${correctAnswer}${nextQuestion}`
    }
    return `Составы команд:\n${Object.keys(state.teams)
        .map(
            teamName =>
                `<b>${teamName}</b>: ${Object.keys(state.users).filter(chatId => state.users[Number(chatId)].teamName === teamName).map(chatId => state.users[Number(chatId)].name).join(', ')}`
        )
        .join('\n')}`
}

const getGameUserState = (chatId: number): string => {
    const teamName = state.users[chatId].teamName
    if (state.game && teamName) {
        const { id, questionNumber, waiting} = state.game
        if (waiting) {
            return 'Ждём следующий вопрос...'
        }
        const answer = state.teams[teamName]?.answers[id][questionNumber]
        return answer ? `Ваш ответ: <b>${answer}</b>` : 'Жду ответ...'
    }
    return 'Как я сюда попал? Чет не работает похоже...'
}

const getLevelQuestion = (): string => {
    if (state.game) {
        const { id, questionNumber} = state.game
        return games[id].questions[questionNumber].text
    }
    return 'Как я сюда попал? Чет не работает похоже...'
}

const getLevelQuestionNumber = (): string => {
    if (state.game) {
        const { id } = state.game
        const { questionNumber} = state.game
        return `<b>Вопрос ${questionNumber + 1}.</b> ${games[id].name}.`
    }
    return 'Как я сюда попал? Чет не работает похоже...'
}

const showResults = async (gameId: string) => {
    const {name, questions} = games[gameId]
    await showAllNotFreeUsersMessage(`Игра ${name}`)
    for (let index = 0; index < questions.length; index++) {
        await showAllNotFreeUsersMessage(
            `<b>Вопрос ${index + 1}</b>: ${questions[index].text}\n\n<b>Правильный ответ</b>: ${questions[index].correct}\n\n<b>Ответы команд</b>:\n\n${Object.keys(state.teams)
                .map(
                    teamName =>
                        `        <b>${teamName}</b>: ${state.teams[teamName]?.answers[gameId][index] ?? '<i>Нет ответа</i>'}`
                )
                .join('\n')
            }`)
    }
}

const showAdminMenu = async (msg: BotMessage) => {
    await removeLastMessage(msg)
    if (state.game) {
        await setMessageWithLast(msg.chat.id, getGameAdminState(), {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    ...(state.game.waiting ? [[{text: 'Запустить следующий вопрос', callback_data: 'next_level'}]] : []),
                    [{ text: 'Остановить Игру', callback_data: 'stop_game' }]
                ]
            }
        })
    } else {
        await setMessageWithLast(msg.chat.id, getGameAdminState(), {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{text: 'Добавить команду', callback_data: 'add_team'}],
                    ...(
                        Object.keys(state.teams).length
                            ? [
                                ...Object.keys(games).map(gameId =>
                                    [
                                        {text: games[gameId].adminName, callback_data: `start_game ${gameId}`},
                                        {text: 'Результаты.', callback_data: `game_results ${gameId}`}
                                    ]
                                )
                            ]
                            : []
                    ),
                    ...Object.keys(state.teams).map(teamName => [{
                        text: `Удалить команду "${teamName}"`,
                        callback_data: `remove_team ${teamName}`
                    }])
                ]
            }
        })
    }
}

const showUserMenu = async (msg: BotMessage) => {
    await removeLastMessage(msg)
    const { teamName } = getUser(msg)
    if (teamName) {
        if (state.game) {
            if (isSteppedQuestion()) {
                await setMessageWithLast(msg.chat.id, getGameUserState(msg.chat.id), state.game.waiting
                    ? {}
                    : {
                        parse_mode: "HTML",
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    {text: 'Верю', callback_data: 'answer_question Верю'},
                                    {text: 'Не верю', callback_data: 'answer_question Не верю'}
                                ]
                            ]
                        }
                })
            } else {
                await setMessageWithLast(msg.chat.id, getGameUserState(msg.chat.id), {
                    parse_mode: "HTML"
                })
            }
        } else {
            await setMessageWithLast(msg.chat.id, `Ваша Команда: <b>${teamName}</b>`, {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [{text: 'Покинуть команду.', callback_data: 'leave_team'}]
                    ]
                }
            })
        }
    } else {
        await setMessageWithLast(msg.chat.id, Object.keys(state.teams).length ? 'Выберите Команду.' : 'Подождите, формируем команды.', {
            reply_markup: {
                inline_keyboard: [
                    ...Object.keys(state.teams).map(teamName => [{ text: `Присоединиться к команде "${teamName}"`, callback_data: `join_team ${teamName}`}])
                ]
            }
        })
    }
}

const showMenu = async (msg: BotMessage) => {
    const user = getUser(msg)

    switch (user.role) {
        case 'ADMIN':
            await showAdminMenu(msg)
            break;
        case 'USER':
            await showUserMenu(msg)
            break;
    }
}

const showAllNotFreeUsersMessage = async (text: string, excludeAdmins?: boolean) => {
    await Promise.all(getNotFreeUsers(excludeAdmins).map(async (chatId: number) => await bot.sendMessage(chatId, text, { parse_mode: 'HTML' })))
}

const updateAllNotFreeUsersMenu = async (excludeAdmins?: boolean) => {
    await Promise.all(getNotFreeUsers(excludeAdmins).map(async (chatId: number) => await showMenu({ chat: { id: chatId } })))
}

const updateAllFreeUsersMenu = async (excludeAdmins?: boolean) => {
    await Promise.all(getFreeUsers(excludeAdmins).map(async (chatId: number) => await showMenu({ chat: { id: chatId } })))
}

const updateAllTeamUsersMenu = async (teamName: string, excludeAdmins?: boolean) => {
    await Promise.all(getTeamUsers(teamName, excludeAdmins).map(async (chatId: number) => await showMenu({ chat: { id: chatId } })))
}

const bot = new TelegramBot(process.env.BOT_TOKEN || 'TEST', { polling: true })

bot.setMyCommands(commands).then(result => console.log('setCommand result', result))

bot.onText(/\/start/, showMenu)

bot.onText(/\/auth (.+) (.+)/, async (msg, match) => {
    try {
        const [, login, password] = match || []
        const success = login === process.env.ADMIN_LOGIN && password === process.env.ADMIN_PASSWORD

        if (success) {
            setRole(msg.chat.id, 'ADMIN')
        }
        await showMenu(msg)
    } catch (e) {}
});

bot.onText(/\/logout/, async (msg, match) => {
    try {
        setRole(msg.chat.id, 'USER')
        await showMenu(msg)
    } catch (e) {}
});

bot.on('callback_query', async ctx => {
    try {
        const { message: msg, data = ''} = ctx

        const [, command, arg] = data.match(CONTEXT_DATA_COMMAND_REGEXP) || []

        switch(command) {
            case 'add_team':
                if (msg) {
                    await removeLastMessage(msg)
                    await setMessageWithWaitAction(msg.chat.id, 'Введите название команды', {}, 'team_name')
                }
                break
            case 'remove_team':
                if (msg) {
                    const chatIdsToUpdate = removeTeam(arg)
                    await showMenu(msg)
                    chatIdsToUpdate.forEach(chatId => showMenu({chat: {id: chatId}}))
                }
                break
            case 'join_team':
                if (msg) {
                    if (!joinTeam(msg, arg)) {
                        await removeLastMessage(msg)
                        await bot.sendMessage(msg.chat.id, 'Нет такой команды как бы...');
                    }
                    await updateAllNotFreeUsersMenu()
                }
                break
            case 'leave_team':
                if (msg) {
                    if (!leaveTeam(msg)) {
                        await removeLastMessage(msg)
                        await bot.sendMessage(msg.chat.id, 'Ни в какой команде не состоял вроде...');
                    }
                    await updateAllFreeUsersMenu()
                }
                break
            case 'start_game':
                if (msg) {
                    await startGame(arg)
                    await updateAllNotFreeUsersMenu()
                }
                break
            case 'stop_game':
                if (msg) {
                    removeGameInProgress()
                    await updateAllNotFreeUsersMenu()
                }
                break
            case 'game_results':
                if (msg) {
                    await showResults(arg)
                }
                break
            case 'answer_question':
                if (msg) {
                    const { role, teamName} = getUser(msg)
                    if (role === 'USER' && teamName && state.game) {
                        setTeamCurrentAnswer(teamName, arg)
                        await updateAllTeamUsersMenu(teamName)
                    }
                }
                break
            case 'next_level':
                if (msg) {
                    await switchLevel()
                }
                break
        }
    } catch (e) {}
})
bot.onText(NORMAL_TEXT_REGEXP, async (msg, match) => {
    try {
        const { waitAction, role, teamName } = getUser(msg)

        if (role === 'USER' && teamName && state.game && !isSteppedQuestion()) {
            setTeamCurrentAnswer(teamName, msg.text as string)
            await updateAllTeamUsersMenu(teamName)
        } else {
            switch (waitAction) {
                case 'team_name':
                    if (addTeam(msg.text as string)) {
                        setUserWaitAction(msg.chat.id, undefined)
                        await updateAllFreeUsersMenu()
                    } else {
                        await removeLastMessage(msg)
                        await bot.sendMessage(msg.chat.id, 'С таким именем команда уже есть. Попробуй ещё раз.');
                    }
                    break;
            }
        }
    } catch (e) {}
})

bot.onText(NON_COMMAND_REGEXP, async (msg) => {
    try {
        const { waitAction } = getUser(msg)

        if (waitAction) {
            if (!msg.text?.match(NORMAL_TEXT_REGEXP)) {
                await removeLastMessage(msg)
                await bot.sendMessage(msg.chat.id, 'Нормальный текст введи. Буквы русские или английские, пробелы там, цифры и хорош.');
            }
        }
    } catch (e) {}
});