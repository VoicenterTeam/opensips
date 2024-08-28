<template>
    <div class="example pt-10">
        <div id="loginPage">
            <form id="loginToAppForm" class="login-form">
                <label>
                    Pn Params:
                    <input type="text" name="pnparams" value="">
                </label>
                <label>
                    Username:
                    <input type="text" name="username" value="">
                </label>
                <label>
                    Password:
                    <input type="text" name="password" value="">
                </label>
                <label>
                    JWT Token:
                    <input type="text" name="token" value="">
                </label>
                <label>
                    Domain:
                    <input type="text" name="domain" value="">
                </label>
                <button type="submit">
                    Register
                </button>
            </form>
        </div>
        <div id="webRTCPage" style="display: none">
            <div>
                <select id="microphoneEl"/>
                <select id="speakerEl"/>
            </div>

            <div class="call-quick-actions">
                <div>
                    <label for="muteWhenJoinInputEl">Mute when join</label>
                    <input id="muteWhenJoinInputEl" type="checkbox">
                </div>
                <div>
                    <label for="DNDInputEl">DND</label>
                    <input id="DNDInputEl" type="checkbox">
                </div>
            </div>

            <div>
                <div id="muteContainerEl">
                    <button class="muteButtonEl">
                        Mute
                    </button>
                </div>
            </div>

            <br>

            <form id="makeCallForm">
                <label>
                    Your target:
                    <input type="text" name="target">
                </label>
                <button type="submit">
                    Call
                </button>
            </form>
            <div id="callAddingIndicator" class="hidden">Calling...</div>

            <div>
                <label for="addToCurrentRoomInputEl">Add new call to current room</label>
                <input id="addToCurrentRoomInputEl" type="checkbox">
            </div>

            <br>

            <div>
                <label for="inputLevel">Microphone sensitivity (between 0 and 2):</label>
                <input
id="inputLevel"
                       type="number"
                       name="inputLevel"
                       value="1"
                       min="0"
                       max="1"
                       step="0.1"
                >
                <button id="inputLevelApplyButton">Apply</button>
            </div>
            <div>
                <label for="outputLevel">Speaker volume (between 0 and 1):</label>
                <input
id="outputLevel"
                       type="number"
                       name="outputLevel"
                       value="1"
                       min="0"
                       max="1"
                       step="0.1"
                >
                <button id="outputLevelApplyButton">Apply</button>
            </div>

            <br>

            <div>
                <form id="dtmfForm">
                    <label>
                        DTMF input:
                        <input id="dtmfInput" type="text">
                    </label>
                    <button id="dtmfSendButton" type="submit" disabled>
                        Send
                    </button>
                </form>
            </div>

            <div id="agentVoiceLevelContainer"/>

            <div>
                Active calls: <span id="activeCallsCounter">0</span>
                <p>Your room: </p>
                <select id="roomSelect">
                    <option value="" class="noData" selected>No room selected</option>
                </select>
            </div>

            <br>
            <p>RoomList</p>
            <br>

            <div id="roomsContainer"/>

            <form id="videoCallForm">
                <label>
                    Join video room:
                    <input type="text" placeholder="Room" name="target" value="abcd">
                </label>
                <label>
                    Display name:
                    <input type="text" placeholder="Name" name="name" value="User1">
                </label>
                <button type="submit">
                    Join
                </button>
                <button id="terminateJanusSessionButton">
                    Terminate
                </button>
            </form>

            <div id="mainVideoElementContainer" style="width: 100%"/>

            <div id="participantsVideoElements" style="width: 100%"/>

            <!--        <form id="sendMessageForm">
                      <label id="msrpTargetLabel">
                        Your target:
                        <input type="text" name="target">
                      </label>
                      <label>
                        Your Message:
                        <input type="text" name="message">
                      </label>
                      <label>
                        Extra Headers (comma separated):
                        <textarea name="extraHeaders"></textarea>
                      </label>
                      <button type="submit">
                        Send message
                      </button>
                    </form>
                    <div id="messagesContainer"></div>-->

        </div>
    </div>
</template>
<script setup lang="ts">

onMounted(async () => {
    await import('../../demo/index')
})
</script>
<style lang="scss" scoped>
@import '../../demo/styles.css';
</style>
